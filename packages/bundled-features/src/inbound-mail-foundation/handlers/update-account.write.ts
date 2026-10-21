// update-account — Account status transitions: the watch supervisor reports
// error/backoff, OAuth refresh fails (auth_error), or a tenant admin re-enables
// the account after fixing its credentials. Full-snapshot event: loads the
// latest state, merges the delta fields, and appends the new snapshot.

import type { WriteHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import { failNotFound, failUnprocessable } from "@cosmicdrift/kumiko-framework/errors";
import * as z from "zod";
import { InboundMailAccountStatuses } from "../constants.ts";
import {
  MAIL_ACCOUNT_AGGREGATE_TYPE,
  MAIL_ACCOUNT_UPDATED_EVENT_QN,
  type MailAccountEventHeaders,
  type MailAccountEventPayload,
} from "../events.ts";
import { loadCurrentMailAccountPayload } from "./account-state.ts";

export const updateAccountSchema = z.object({
  accountId: z.uuid(),
  status: z
    .enum([
      InboundMailAccountStatuses.active,
      InboundMailAccountStatuses.authError,
      InboundMailAccountStatuses.degraded,
    ])
    .optional(),
  /** Ops-Signal ("idle", "watching", "backoff:3", ...). */
  watchState: z.string().max(100).optional(),
  displayName: z.string().max(200).optional(),
  /** Audit reason for metadata.headers ("watch_supervisor",
   *  "oauth_refresh", "tenant_admin"). */
  reason: z.string().min(1).max(100),
});
type UpdateAccountPayload = z.infer<typeof updateAccountSchema>;

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
      // Disconnected accounts are final; re-enabling requires a fresh connect
      // (new stream, new secret slot). This prevents a delayed supervisor tick
      // from restoring a disconnected account to active (disconnect vs. poll
      // race).
      return failUnprocessable("account_disconnected", { accountId: payload.accountId });
    }

    // address/provider/authMethod come unchanged from the latest snapshot
    // (address remains ciphertext—never re-encrypt it).
    const eventPayload: MailAccountEventPayload = {
      ...current,
      ...(payload.status !== undefined ? { status: payload.status } : {}),
      ...(payload.watchState !== undefined ? { watchState: payload.watchState } : {}),
      ...(payload.displayName !== undefined ? { displayName: payload.displayName } : {}),
    };
    const headers: MailAccountEventHeaders = {
      providerName: current.provider,
      reason: payload.reason,
    };
    await ctx.unsafeAppendEvent({
      aggregateId: payload.accountId,
      aggregateType: MAIL_ACCOUNT_AGGREGATE_TYPE,
      type: MAIL_ACCOUNT_UPDATED_EVENT_QN,
      payload: eventPayload,
      headers,
    });

    return { isSuccess: true as const, data: { accountId: payload.accountId } };
  },
};
