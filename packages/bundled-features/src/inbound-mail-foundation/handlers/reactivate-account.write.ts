// reactivate-account — the only way from disconnected back to active (it also clears auth_error
// and degraded). update-account keeps rejecting disconnected accounts so a late supervisor tick
// can never undo a disconnect; a deliberate reconnect goes through here instead, keeping the
// accountId and with it cursor, seen anchors and threads.

import { requireSecretsContext } from "@cosmicdrift/kumiko-bundled-features/secrets";
import type { HandlerContext, WriteHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import {
  AccessDeniedError,
  failNotFound,
  UnprocessableError,
  writeFailure,
} from "@cosmicdrift/kumiko-framework/errors";
import * as z from "zod";
import {
  InboundMailAccountStatuses,
  InboundMailConnectErrors,
  inboundCredentialSecretKey,
} from "../constants.ts";
import {
  MAIL_ACCOUNT_AGGREGATE_TYPE,
  MAIL_ACCOUNT_UPDATED_EVENT_QN,
  type MailAccountEventHeaders,
  type MailAccountEventPayload,
} from "../events.ts";
import { loadCurrentMailAccountPayload } from "./account-state.ts";
import { mayReactivateMailbox } from "./scope-visibility.ts";

export const RECONNECT_AUDIT_REASON = "reconnect";

// Strict: the trusted authserv-id only changes through set-trusted-authserv-id.
export const reactivateAccountSchema = z.object({ accountId: z.uuid() }).strict();

const CREDENTIAL_PRESENCE_REASON =
  "the credential secret is checked on the request transaction because reconnect-mailbox writes it earlier in the same transaction, which a separate connection would not see";

function isAlreadyHealthy(current: MailAccountEventPayload): boolean {
  return (
    current.status === InboundMailAccountStatuses.active &&
    current.watchState === "idle" &&
    current.lastError === null
  );
}

// Shared with connect-account's in-place OAuth reconnect. Returns false when nothing had to change.
export async function appendMailAccountReactivation(
  ctx: Pick<HandlerContext, "events">,
  accountId: string,
  current: MailAccountEventPayload,
): Promise<boolean> {
  if (isAlreadyHealthy(current)) return false;
  const eventPayload: MailAccountEventPayload = {
    ...current,
    status: InboundMailAccountStatuses.active,
    watchState: "idle",
    lastError: null,
  };
  const headers: MailAccountEventHeaders = {
    providerName: current.provider,
    reason: RECONNECT_AUDIT_REASON,
  };
  await ctx.events.unsafeAppend({
    aggregateId: accountId,
    aggregateType: MAIL_ACCOUNT_AGGREGATE_TYPE,
    type: MAIL_ACCOUNT_UPDATED_EVENT_QN,
    payload: eventPayload,
    headers,
  });
  return true;
}

export const reactivateAccountHandler: WriteHandlerDef = {
  name: "reactivate-account",
  schema: reactivateAccountSchema,
  access: { roles: ["SystemAdmin", "TenantAdmin"] },
  agent: { expose: false },
  escapeHatch: { grants: ["unsafeRaw"], reason: CREDENTIAL_PRESENCE_REASON },
  description:
    "Brings a disconnected, interrupted or sign-in-failed mailbox back to active under its existing accountId, so cursor, seen messages and threads survive; the caller replaces the credential in the same flow.",
  handler: async (event, ctx) => {
    const payload = reactivateAccountSchema.parse(event.payload);
    const current = await loadCurrentMailAccountPayload(ctx, payload.accountId);
    if (!current) return failNotFound("mail-account", payload.accountId);
    if (!mayReactivateMailbox(current.ownerUserId, event.user.id)) {
      return writeFailure(new AccessDeniedError({ details: { reason: "not_mailbox_owner" } }));
    }
    if (current.status === InboundMailAccountStatuses.disconnected) {
      const secrets = requireSecretsContext(
        { secrets: ctx.services.secrets, user: ctx.user },
        "reactivate-account",
      ).withRunner(ctx.db.unsafeRaw());
      const hasCredential = await secrets.has(
        event.user.tenantId,
        inboundCredentialSecretKey(payload.accountId),
      );
      if (!hasCredential) {
        const { reason, i18nKey } = InboundMailConnectErrors.credentialRequired;
        return writeFailure(new UnprocessableError(reason, { i18nKey }));
      }
    }
    const changed = await appendMailAccountReactivation(ctx, payload.accountId, current);
    return { isSuccess: true as const, data: { accountId: payload.accountId, changed } };
  },
};
