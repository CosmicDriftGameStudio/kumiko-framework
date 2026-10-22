// disconnect-account — A TenantAdmin disconnects a mailbox. The stream is retained
// for audit history, the status becomes disconnected, and the watch supervisor
// skips the account starting with the next tick. Secret cleanup (IMAP password/
// refresh token in the accountId slot) is handled by the caller flow; this handler
// does not touch the secrets path.
//
// Idempotent: disconnecting an already disconnected account is a success no-op
// with no second event, making double-clicks and retries safe.

import type { WriteHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import { failNotFound } from "@cosmicdrift/kumiko-framework/errors";
import * as z from "zod";
import { InboundMailAccountStatuses } from "../constants.ts";
import {
  MAIL_ACCOUNT_AGGREGATE_TYPE,
  MAIL_ACCOUNT_DISCONNECTED_EVENT_QN,
  type MailAccountEventHeaders,
  type MailAccountEventPayload,
} from "../events.ts";
import { loadCurrentMailAccountPayload } from "./account-state.ts";

export const disconnectAccountSchema = z.object({
  accountId: z.uuid(),
  reason: z.string().min(1).max(100).default("tenant_admin"),
});
type DisconnectAccountPayload = z.infer<typeof disconnectAccountSchema>;

export const disconnectAccountHandler: WriteHandlerDef = {
  name: "disconnect-account",
  schema: disconnectAccountSchema,
  access: { roles: ["SystemAdmin", "TenantAdmin"] },
  description:
    "Puts a connected mailbox into the final disconnected state so the watch supervisor stops fetching it, keeping the stream for audit and requiring a fresh connect to resume; use it to stop mail ingestion for one mailbox.",
  agent: { risk: "high" },
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
