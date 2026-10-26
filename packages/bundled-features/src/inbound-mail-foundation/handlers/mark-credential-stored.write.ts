// mark-credential-stored — the OAuth callback stores the refresh token after the account commit,
// so the wake from connect-account can fire before the credential exists. This re-emits the
// unchanged active state with a fresh event, which the wake consumer turns into a sync.

import type { WriteHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import { failNotFound } from "@cosmicdrift/kumiko-framework/errors";
import * as z from "zod";
import { InboundMailAccountStatuses } from "../constants.ts";
import {
  MAIL_ACCOUNT_AGGREGATE_TYPE,
  MAIL_ACCOUNT_UPDATED_EVENT_QN,
  type MailAccountEventHeaders,
} from "../events.ts";
import { loadCurrentMailAccountPayload } from "./account-state.ts";

export const CREDENTIAL_STORED_AUDIT_REASON = "credential_stored";

export const markCredentialStoredSchema = z.object({ accountId: z.uuid() });

export const markCredentialStoredHandler: WriteHandlerDef = {
  name: "mark-credential-stored",
  schema: markCredentialStoredSchema,
  access: { roles: ["SystemAdmin"] },
  agent: { expose: false },
  description:
    "Signals that the credential of an active mailbox was stored after the account was created, so the first sync can start right away.",
  handler: async (event, ctx) => {
    const payload = markCredentialStoredSchema.parse(event.payload);
    const current = await loadCurrentMailAccountPayload(ctx, payload.accountId);
    if (!current) return failNotFound("mail-account", payload.accountId);
    if (current.status !== InboundMailAccountStatuses.active) {
      return { isSuccess: true as const, data: { accountId: payload.accountId, marked: false } };
    }
    const headers: MailAccountEventHeaders = {
      providerName: current.provider,
      reason: CREDENTIAL_STORED_AUDIT_REASON,
    };
    await ctx.events.unsafeAppend({
      aggregateId: payload.accountId,
      aggregateType: MAIL_ACCOUNT_AGGREGATE_TYPE,
      type: MAIL_ACCOUNT_UPDATED_EVENT_QN,
      payload: current,
      headers,
    });
    return { isSuccess: true as const, data: { accountId: payload.accountId, marked: true } };
  },
};
