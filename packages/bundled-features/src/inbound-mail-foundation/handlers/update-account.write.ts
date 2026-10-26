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
import { InboundMailAccountStatuses, InboundMailLastErrors } from "../constants.ts";
import {
  MAIL_ACCOUNT_AGGREGATE_TYPE,
  MAIL_ACCOUNT_UPDATED_EVENT_QN,
  type MailAccountEventHeaders,
  type MailAccountEventPayload,
} from "../events.ts";
import { normalizeTrustedAuthservId } from "../sender-auth.ts";
import { loadCurrentMailAccountPayload } from "./account-state.ts";
import { trustedAuthservIdInputSchema } from "./trusted-authserv-id.ts";

export const updateAccountSchema = z.object({
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
  /** authserv-id of the mailbox's own server; null or empty clears it, omitted keeps it. */
  trustedAuthservId: trustedAuthservIdInputSchema,
  /** Audit reason for metadata.headers, honored for the system identity only
   *  ("watch_supervisor", "oauth_refresh"); user callers get a role-derived reason. */
  reason: z.string().min(1).max(100).optional(),
});
type UpdateAccountPayload = z.infer<typeof updateAccountSchema>;

const SYSTEM_FALLBACK_REASON = "system";

function auditReasonFor(user: SessionUser, requestedReason: string | undefined): string {
  if (user.id === SYSTEM_USER_ID) return requestedReason ?? SYSTEM_FALLBACK_REASON;
  return user.roles.includes(ROLES.SystemAdmin) ? "system_admin" : "tenant_admin";
}

export const updateAccountHandler: WriteHandlerDef = {
  name: "update-account",
  schema: updateAccountSchema,
  access: { roles: ["SystemAdmin", "TenantAdmin"] },
  description:
    "Records a status, watch-state or display-name change on a connected mailbox as a new snapshot with an audit reason, rejecting any change to an already disconnected mailbox; use it to flag an auth error or to re-activate a mailbox after fixing its credentials.",
  handler: async (event, ctx) => {
    // @cast-boundary engine-payload — dispatcher-zod-validated payload
    const payload = event.payload as UpdateAccountPayload;

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
      ...(payload.trustedAuthservId !== undefined
        ? { trustedAuthservId: normalizeTrustedAuthservId(payload.trustedAuthservId) }
        : {}),
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
