// disconnect-account — Tenant-Admin trennt ein Postfach. Stream bleibt
// (Audit-Historie), Status wird disconnected, der Watch-Supervisor
// überspringt den Account ab dem nächsten Tick. Secret-Cleanup (IMAP-
// Passwort/Refresh-Token im Slot accountId) macht der Aufrufer-Flow —
// der Handler fasst den secrets-Pfad nicht an.
//
// Idempotent: disconnect auf bereits disconnected Account ist ein
// success-no-op (kein zweites Event) — Doppelklick-/Retry-freundlich.

import type { WriteHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import { failNotFound } from "@cosmicdrift/kumiko-framework/errors";
import { z } from "zod";
import { InboundMailAccountStatuses } from "../constants";
import {
  MAIL_ACCOUNT_AGGREGATE_TYPE,
  MAIL_ACCOUNT_DISCONNECTED_EVENT_QN,
  type MailAccountEventHeaders,
  type MailAccountEventPayload,
} from "../events";
import { loadCurrentMailAccountPayload } from "./account-state";

export const disconnectAccountSchema = z.object({
  accountId: z.uuid(),
  reason: z.string().min(1).max(100).default("tenant-admin"),
});
type DisconnectAccountPayload = z.infer<typeof disconnectAccountSchema>;

export const disconnectAccountHandler: WriteHandlerDef = {
  name: "disconnect-account",
  schema: disconnectAccountSchema,
  access: { roles: ["SystemAdmin", "TenantAdmin"] },
  handler: async (event, ctx) => {
    // @cast-boundary engine-payload — dispatcher-zod-validated payload
    const payload = event.payload as DisconnectAccountPayload;

    const current = await loadCurrentMailAccountPayload(ctx, payload.accountId);
    if (!current) {
      return failNotFound("mail-account", payload.accountId);
    }
    if (current.status === InboundMailAccountStatuses.disconnected) {
      return {
        isSuccess: true as const,
        data: { accountId: payload.accountId, alreadyDisconnected: true as const },
      };
    }

    const eventPayload: MailAccountEventPayload = {
      ...current,
      status: InboundMailAccountStatuses.disconnected,
      watchState: "idle",
    };
    const headers: MailAccountEventHeaders = {
      providerName: current.provider,
      reason: payload.reason,
    };
    await ctx.unsafeAppendEvent({
      aggregateId: payload.accountId,
      aggregateType: MAIL_ACCOUNT_AGGREGATE_TYPE,
      type: MAIL_ACCOUNT_DISCONNECTED_EVENT_QN,
      payload: eventPayload,
      headers,
    });

    return {
      isSuccess: true as const,
      data: { accountId: payload.accountId, alreadyDisconnected: false as const },
    };
  },
};
