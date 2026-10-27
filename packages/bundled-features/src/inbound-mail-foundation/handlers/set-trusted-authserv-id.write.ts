// set-trusted-authserv-id — the one place that changes which Authentication-Results header the
// sender check believes. It is separate from connect/update/reactivate on purpose: a payload that
// can smuggle this value in through a generic update would let any caller mark forged headers as
// trusted, and it must never be a model-callable tool.

import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { failNotFound, failUnprocessable } from "@cosmicdrift/kumiko-framework/errors";
import * as z from "zod";
import { InboundMailAccountStatuses } from "../constants.ts";
import {
  MAIL_ACCOUNT_AGGREGATE_TYPE,
  MAIL_ACCOUNT_UPDATED_EVENT_QN,
  type MailAccountEventHeaders,
  type MailAccountEventPayload,
} from "../events.ts";
import type { InboundMailRoles } from "../mail-roles.ts";
import { normalizeTrustedAuthservId } from "../sender-auth.ts";
import { loadCurrentMailAccountPayload } from "./account-state.ts";
import { trustedAuthservIdInputSchema } from "./trusted-authserv-id.ts";
import { auditReasonFor } from "./update-account.write.ts";

export const setTrustedAuthservIdSchema = z
  .object({
    accountId: z.uuid(),
    trustedAuthservId: trustedAuthservIdInputSchema,
  })
  .strict();

export const createSetTrustedAuthservIdHandler = ({ adminRoles }: InboundMailRoles) =>
  defineWriteHandler({
    name: "set-trusted-authserv-id",
    schema: setTrustedAuthservIdSchema,
    // A tenant security policy, personal mailboxes included: a trusted authserv-id makes forged senders
    // count as authenticated for the whole tenant (contact matching, auto replies), so owners never set it.
    access: { roles: [...adminRoles] },
    agent: { expose: false },
    description:
      "Sets or clears the authserv-id of the mailbox's own server, which decides whose Authentication-Results header the sender check trusts; null or empty clears it, a connected mailbox only.",
    handler: async (event, ctx) => {
      const payload = event.payload;
      const current = await loadCurrentMailAccountPayload(ctx, payload.accountId);
      if (!current) return failNotFound("mail-account", payload.accountId);
      if (current.status === InboundMailAccountStatuses.disconnected) {
        return failUnprocessable("account_disconnected", { accountId: payload.accountId });
      }

      const trustedAuthservId = normalizeTrustedAuthservId(payload.trustedAuthservId);
      if (current.trustedAuthservId === trustedAuthservId) {
        return { isSuccess: true as const, data: { accountId: payload.accountId, changed: false } };
      }

      const eventPayload: MailAccountEventPayload = { ...current, trustedAuthservId };
      const headers: MailAccountEventHeaders = {
        providerName: current.provider,
        reason: auditReasonFor(event.user, undefined),
      };
      await ctx.events.unsafeAppend({
        aggregateId: payload.accountId,
        aggregateType: MAIL_ACCOUNT_AGGREGATE_TYPE,
        type: MAIL_ACCOUNT_UPDATED_EVENT_QN,
        payload: eventPayload,
        headers,
      });
      return { isSuccess: true as const, data: { accountId: payload.accountId, changed: true } };
    },
  });
