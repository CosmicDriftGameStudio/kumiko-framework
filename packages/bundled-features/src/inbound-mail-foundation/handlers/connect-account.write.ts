// connect-account — A tenant admin connects a mailbox (a member's personal one goes through the provider form, which dispatches here as the system user). Creates the
// mail-account stream (aggregateId = random uuid = accountId =
// secret-slot key for the IMAP password/OAuth refresh token).
//
// **What does NOT happen here:**
//   - No secret write: IMAP credentials use the secrets path, and OAuth
//     tokens use the generic /inbound-mail/oauth routes—both before or
//     after this call, never in the handler payload (plain passwords must
//     not enter a write payload that can appear in the dispatcher log).
//   - No connection test: the watch supervisor attempts the first fetch
//     and switches to auth_error via update-account on failure—the connect
//     stays fast and offline-capable (the test result arrives asynchronously
//     as a status transition).
//   - No second account for one address: a live or disconnected address is
//     refused (409 reasons in InboundMailConnectErrors); only a disconnected or
//     sign-in-failed OAuth mailbox is reopened in place, keeping its account id and cursor.
//     The reopen returns the existing id and changes nothing yet; the callback re-arms it.

import {
  configuredPiiSubjectKms,
  encryptPiiFieldValues,
} from "@cosmicdrift/kumiko-framework/crypto";
import type { WriteHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import {
  failUnprocessable,
  UnprocessableError,
  writeFailure,
} from "@cosmicdrift/kumiko-framework/errors";
import * as z from "zod";
import {
  InboundMailAccountStatuses,
  InboundMailAuthMethods,
  InboundMailConnectErrors,
  InboundMailFoundationHandlers,
} from "../constants.ts";
import { MAIL_ACCOUNT_PII_FIELDS, mailAccountEntity } from "../entities.ts";
import {
  MAIL_ACCOUNT_AGGREGATE_TYPE,
  MAIL_ACCOUNT_CONNECTED_EVENT_QN,
  type MailAccountEventHeaders,
  type MailAccountEventPayload,
} from "../events.ts";
import { accessRolesOf, type InboundMailRoles } from "../mail-roles.ts";
import { connectConflictOf, findMailboxByAddress } from "./account-address.ts";

export const connectAccountSchema = z
  .object({
    /** Provider key registered with the extension ("imap",
     *  "m365-graph", "gmail-rest"). */
    provider: z.string().min(1).max(50),
    authMethod: z.enum([
      InboundMailAuthMethods.password,
      InboundMailAuthMethods.xoauth2,
      InboundMailAuthMethods.oauth,
    ]),
    displayName: z.string().trim().max(200),
    /** Mailbox address in plaintext; it is encrypted here. */
    address: z.string().min(1).max(320),
    /** "shared" = shared across the tenant (info@) · "user" = the caller's
     *  personal mailbox (ownerUserId is taken from the session, never from
     *  the payload—preventing claims on another user's mailbox). */
    scope: z.enum(["shared", "user"]),
    /** Only for the programmatic OAuth callback path (SystemAdmin): there,
     *  the dispatcher user is a SystemUser and the actual owner is in the
     *  HMAC-verified state. Tenant callers must not set this field (the
     *  handler prevents claims on another user's mailbox). */
    ownerUserIdOverride: z.string().max(36).nullable().optional(),
  })
  // trustedAuthservId is deliberately not accepted here: it decides which Authentication-Results header
  // is believed, so it only changes through set-trusted-authserv-id.
  .strict();
type ConnectAccountPayload = z.infer<typeof connectAccountSchema>;

export function createConnectAccountHandler({ adminRoles }: InboundMailRoles): WriteHandlerDef {
  return {
    name: "connect-account",
    schema: connectAccountSchema,
    access: { roles: accessRolesOf(InboundMailFoundationHandlers.connectAccount, adminRoles) },
    // Connects a mailbox, like disconnect-account (risk high), which the model must not trigger on its own.
    agent: { expose: false },
    description:
      "Registers a mailbox for the tenant (provider, auth method, display name, encrypted address, shared or personal) and returns the new accountId that also keys its credential slot; use it to start a mail connection, credentials and the first connection test happen outside this call.",
    handler: async (event, ctx) => {
      // @cast-boundary engine-payload — dispatcher-zod-validated payload
      const payload = event.payload as ConnectAccountPayload;
      const tenantId = event.user.tenantId;
      const accountId = crypto.randomUUID();

      if (payload.ownerUserIdOverride !== undefined && !event.user.roles.includes("SystemAdmin")) {
        return failUnprocessable("owner_override_requires_system_admin");
      }
      const ownerUserId =
        payload.ownerUserIdOverride !== undefined
          ? payload.ownerUserIdOverride
          : payload.scope === "user"
            ? event.user.id
            : null;

      const existing = await findMailboxByAddress(ctx, tenantId, payload.address);
      if (existing) {
        const matched = connectConflictOf(existing, {
          authMethod: payload.authMethod,
          provider: payload.provider,
          ownerUserId,
        });
        // Only the OAuth callback (it passes ownerUserIdOverride) reopens: it stores the fresh token and
        // only then switches the account on via reactivate-account. Everyone else gets the plain conflict.
        const conflict =
          matched === "reopen_in_place" && payload.ownerUserIdOverride === undefined
            ? existing.status === InboundMailAccountStatuses.disconnected
              ? "address_disconnected"
              : "already_connected"
            : matched;
        if (conflict === "reopen_in_place") {
          return {
            isSuccess: true as const,
            data: { accountId: existing.id, reconnected: true as const },
          };
        }
        const { reason, i18nKey } =
          conflict === "address_disconnected"
            ? InboundMailConnectErrors.addressDisconnected
            : InboundMailConnectErrors.addressAlreadyConnected;
        return writeFailure(new UnprocessableError(reason, { i18nKey }));
      }

      // PII-encrypt the address before the append. This is the only write path to
      // the stream, so it covers both the event log and the projection.
      const piiKms = configuredPiiSubjectKms();
      const plainPii = { tenantId, address: payload.address };
      const encryptedFields = piiKms
        ? await encryptPiiFieldValues(
            plainPii,
            mailAccountEntity,
            MAIL_ACCOUNT_PII_FIELDS,
            piiKms,
            { requestId: `inbound-mail-foundation:connect-account:${accountId}`, tenantId },
            { tenantId, entityName: MAIL_ACCOUNT_AGGREGATE_TYPE },
          )
        : plainPii;

      const eventPayload: MailAccountEventPayload = {
        provider: payload.provider,
        authMethod: payload.authMethod,
        ownerUserId,
        displayName: payload.displayName,
        address: encryptedFields.address,
        // The account is active upon connection; the supervisor picks it up on
        // the next tick and downgrades it when credentials fail.
        status: InboundMailAccountStatuses.active,
        watchState: "idle",
        lastError: null,
        trustedAuthservId: null,
      };
      const headers: MailAccountEventHeaders = {
        providerName: payload.provider,
        reason: "connect_flow",
      };
      await ctx.events.unsafeAppend({
        aggregateId: accountId,
        aggregateType: MAIL_ACCOUNT_AGGREGATE_TYPE,
        type: MAIL_ACCOUNT_CONNECTED_EVENT_QN,
        payload: eventPayload,
        headers,
      });

      return { isSuccess: true as const, data: { accountId, reconnected: false as const } };
    },
  };
}
