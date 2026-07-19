// update-account — Account-Status-Übergänge: Watch-Supervisor meldet
// error/backoff, OAuth-Refresh scheitert (auth_error), Tenant-Admin
// re-enabled nach Credential-Fix. Full-snapshot-Event: lädt den letzten
// Stand, merged die Delta-Felder, appendet den neuen Snapshot.

import type { WriteHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import { failNotFound, failUnprocessable } from "@cosmicdrift/kumiko-framework/errors";
import { z } from "zod";
import { InboundMailAccountStatuses } from "../constants";
import {
  MAIL_ACCOUNT_AGGREGATE_TYPE,
  MAIL_ACCOUNT_UPDATED_EVENT_QN,
  type MailAccountEventHeaders,
  type MailAccountEventPayload,
} from "../events";
import { loadCurrentMailAccountPayload } from "./account-state";

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
  /** Audit-Grund für metadata.headers ("watch_supervisor",
   *  "oauth_refresh", "tenant_admin"). */
  reason: z.string().min(1).max(100),
});
type UpdateAccountPayload = z.infer<typeof updateAccountSchema>;

export const updateAccountHandler: WriteHandlerDef = {
  name: "update-account",
  schema: updateAccountSchema,
  access: { roles: ["SystemAdmin", "TenantAdmin"] },
  handler: async (event, ctx) => {
    // @cast-boundary engine-payload — dispatcher-zod-validated payload
    const payload = event.payload as UpdateAccountPayload;

    const current = await loadCurrentMailAccountPayload(ctx, payload.accountId);
    if (!current) {
      return failNotFound("mail-account", payload.accountId);
    }
    if (current.status === InboundMailAccountStatuses.disconnected) {
      // Getrennte Accounts sind final — Re-Enable läuft über einen
      // frischen connect (neuer Stream, neuer Secret-Slot). Verhindert
      // dass ein nachzügelnder Supervisor-Tick einen disconnected
      // Account wieder auf active hebt (Race Disconnect vs. Poll).
      return failUnprocessable("account_disconnected", { accountId: payload.accountId });
    }

    // Merge: address/provider/authMethod kommen 1:1 aus dem letzten
    // Snapshot (address bleibt Ciphertext — nie re-encrypten).
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
