// reactivate-account — the only way from disconnected back to active (it also clears auth_error
// and degraded). update-account keeps rejecting disconnected accounts so a late supervisor tick
// can never undo a disconnect; a deliberate reconnect goes through here instead, keeping the
// accountId and with it cursor, seen anchors and threads.

import type { HandlerContext, WriteHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import { failNotFound } from "@cosmicdrift/kumiko-framework/errors";
import * as z from "zod";
import { InboundMailAccountStatuses } from "../constants.ts";
import {
  MAIL_ACCOUNT_AGGREGATE_TYPE,
  MAIL_ACCOUNT_UPDATED_EVENT_QN,
  type MailAccountEventHeaders,
  type MailAccountEventPayload,
} from "../events.ts";
import { loadCurrentMailAccountPayload } from "./account-state.ts";

export const RECONNECT_AUDIT_REASON = "reconnect";

export const reactivateAccountSchema = z.object({ accountId: z.uuid() });

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
  description:
    "Brings a disconnected, interrupted or sign-in-failed mailbox back to active under its existing accountId, so cursor, seen messages and threads survive; the caller replaces the credential in the same flow.",
  handler: async (event, ctx) => {
    const payload = reactivateAccountSchema.parse(event.payload);
    const current = await loadCurrentMailAccountPayload(ctx, payload.accountId);
    if (!current) return failNotFound("mail-account", payload.accountId);
    const changed = await appendMailAccountReactivation(ctx, payload.accountId, current);
    return { isSuccess: true as const, data: { accountId: payload.accountId, changed } };
  },
};
