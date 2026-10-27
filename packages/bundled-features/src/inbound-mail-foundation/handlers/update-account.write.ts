// update-account — Account status transitions: the watch supervisor reports
// error/backoff, OAuth refresh fails (auth_error), or a tenant admin re-enables
// the account after fixing its credentials. Full-snapshot event: loads the
// latest state, merges the delta fields, and appends the new snapshot.

import { ROLES } from "@cosmicdrift/kumiko-framework/auth";
import {
  type SessionUser,
  SYSTEM_USER_ID,
  type WriteHandlerDef,
} from "@cosmicdrift/kumiko-framework/engine";
import { failNotFound, failUnprocessable } from "@cosmicdrift/kumiko-framework/errors";
import * as z from "zod";
import {
  InboundMailAccountStatuses,
  InboundMailFoundationHandlers,
  InboundMailLastErrors,
} from "../constants.ts";
import {
  MAIL_ACCOUNT_AGGREGATE_TYPE,
  MAIL_ACCOUNT_UPDATED_EVENT_QN,
  type MailAccountEventHeaders,
  type MailAccountEventPayload,
} from "../events.ts";
import { accessRolesOf, type InboundMailRoles } from "../mail-roles.ts";
import { loadCurrentMailAccountPayload } from "./account-state.ts";

export const updateAccountSchema = z
  .object({
    accountId: z.uuid(),
    status: z
      .enum([
        InboundMailAccountStatuses.active,
        InboundMailAccountStatuses.authError,
        InboundMailAccountStatuses.degraded,
      ])
      .optional(),
    /** Why the mailbox is degraded; null clears it. Codes only, never provider error text. */
    lastError: z.enum(Object.values(InboundMailLastErrors)).nullable().optional(),
    /** Ops-Signal ("idle", "watching", "backoff:3", ...). */
    watchState: z.string().max(100).optional(),
    displayName: z.string().trim().max(200).optional(),
    /** Audit reason for metadata.headers, honored for the system identity only
     *  ("watch_supervisor", "oauth_refresh"); user callers get a role-derived reason. */
    reason: z.string().min(1).max(100).optional(),
  })
  .strict();
type UpdateAccountPayload = z.infer<typeof updateAccountSchema>;

const SYSTEM_FALLBACK_REASON = "system";

export function auditReasonFor(user: SessionUser, requestedReason: string | undefined): string {
  if (user.id === SYSTEM_USER_ID) return requestedReason ?? SYSTEM_FALLBACK_REASON;
  return user.roles.includes(ROLES.SystemAdmin) ? "system_admin" : "tenant_admin";
}

export function createUpdateAccountHandler({ adminRoles }: InboundMailRoles): WriteHandlerDef {
  return {
    name: "update-account",
    schema: updateAccountSchema,
    access: { roles: accessRolesOf(InboundMailFoundationHandlers.updateAccount, adminRoles) },
    description:
      "Renames a connected mailbox (display name) as a new snapshot with an audit reason, rejecting any change to an already disconnected mailbox; status, error and watch state are reserved for the system identity.",
    handler: async (event, ctx) => {
      // @cast-boundary engine-payload — dispatcher-zod-validated payload
      const payload = event.payload as UpdateAccountPayload;

      // Status, error and watch state are machine signals of the supervisor and the OAuth refresh; an admin
      // setting them could hide an auth error or fake an active mailbox.
      const isSystemOnlyField =
        payload.status !== undefined ||
        payload.lastError !== undefined ||
        payload.watchState !== undefined ||
        payload.reason !== undefined;
      if (isSystemOnlyField && event.user.id !== SYSTEM_USER_ID) {
        return failUnprocessable("field_requires_system_identity");
      }

      const current = await loadCurrentMailAccountPayload(ctx, payload.accountId);
      if (!current) {
        return failNotFound("mail-account", payload.accountId);
      }
      if (current.status === InboundMailAccountStatuses.disconnected) {
        // Only reactivate-account may leave disconnected. This prevents a delayed
        // supervisor tick from restoring a disconnected account to active
        // (disconnect vs. poll race).
        return failUnprocessable("account_disconnected", { accountId: payload.accountId });
      }

      // address/provider/authMethod come unchanged from the latest snapshot
      // (address remains ciphertext—never re-encrypt it).
      const eventPayload: MailAccountEventPayload = {
        ...current,
        ...(payload.status !== undefined ? { status: payload.status } : {}),
        ...(payload.watchState !== undefined ? { watchState: payload.watchState } : {}),
        ...(payload.displayName !== undefined ? { displayName: payload.displayName } : {}),
        ...(payload.lastError !== undefined ? { lastError: payload.lastError } : {}),
      };
      const headers: MailAccountEventHeaders = {
        providerName: current.provider,
        reason: auditReasonFor(event.user, payload.reason),
      };
      await ctx.events.unsafeAppend({
        aggregateId: payload.accountId,
        aggregateType: MAIL_ACCOUNT_AGGREGATE_TYPE,
        type: MAIL_ACCOUNT_UPDATED_EVENT_QN,
        payload: eventPayload,
        headers,
      });

      return { isSuccess: true as const, data: { accountId: payload.accountId } };
    },
  };
}
