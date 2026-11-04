import { defineWriteHandler, type HandlerContext } from "@cosmicdrift/kumiko-framework/engine";
import { InternalError, RateLimitError } from "@cosmicdrift/kumiko-framework/errors";
import type { TenantId } from "@cosmicdrift/kumiko-types/identifiers";
import { whatsappMessageAggregateId, whatsappStatusAggregateId } from "./aggregate-id.ts";
import {
  type MessageReceivedPayload,
  receiveMessageInputSchema,
  recordStatusInputSchema,
  type StatusUpdatedPayload,
  type ThrottledPayload,
  WHATSAPP_MESSAGE_AGGREGATE_TYPE,
  WHATSAPP_MESSAGE_RECEIVED_EVENT_QN,
  WHATSAPP_STATUS_AGGREGATE_TYPE,
  WHATSAPP_STATUS_UPDATED_EVENT_QN,
  WHATSAPP_THROTTLED_EVENT_QN,
} from "./events.ts";
import type { ResolvedWhatsappOptions } from "./options.ts";
import { encryptWhatsappPii, WhatsappPiiFields } from "./pii.ts";

export type InboundOutcome = "stored" | "duplicate" | "throttled";

type InboundResult = {
  readonly isSuccess: true;
  readonly data: { readonly outcome: InboundOutcome };
};

const OUTCOME_STORED: InboundResult = { isSuccess: true, data: { outcome: "stored" } };
const OUTCOME_DUPLICATE: InboundResult = { isSuccess: true, data: { outcome: "duplicate" } };
const OUTCOME_THROTTLED: InboundResult = { isSuccess: true, data: { outcome: "throttled" } };

type LimitContext = Pick<HandlerContext, "services" | "rateLimitDigest">;

// Counts one message against every per-sender window. Only a RateLimitError means "throttled";
// anything else (Redis down, bad config) propagates so the webhook answers 5xx and Meta redelivers.
async function chargeSender(
  ctx: LimitContext,
  options: ResolvedWhatsappOptions,
  tenantId: TenantId,
  from: string,
): Promise<RateLimitError | null> {
  if (options.senderRateLimits.length === 0) return null;
  const { rateLimit } = ctx.services;
  const digest = ctx.rateLimitDigest;
  if (!rateLimit || !digest) {
    throw new InternalError({
      message: "channel-whatsapp: the per-sender limit needs a rate limiter and a digest key",
    });
  }
  const senderKey = `whatsapp-inbound:${tenantId}:${digest(from)}`;
  try {
    await rateLimit.enforceAll(
      options.senderRateLimits.map(({ limit, windowSeconds }) => ({
        bucket: `${senderKey}:${windowSeconds}s`,
        config: { limit, windowSeconds },
      })),
    );
    return null;
  } catch (error) {
    if (error instanceof RateLimitError) return error;
    throw error;
  }
}

export function createReceiveMessageHandler(options: ResolvedWhatsappOptions) {
  return defineWriteHandler({
    name: "receive-message",
    schema: receiveMessageInputSchema,
    access: { roles: ["SystemAdmin"] },
    rateLimit: options.rateLimit,
    agent: { expose: false },
    description:
      "Stores one inbound WhatsApp message verified by the webhook route as a message-received event; a redelivered wamid is a duplicate, a sender over its limit becomes a throttled event.",
    handler: async (event, ctx) => {
      const input = event.payload;
      const tenantId = event.user.tenantId;
      const aggregateId = whatsappMessageAggregateId(tenantId, input.wamid);

      // Dedupe before the limit: Meta's redeliveries must not use up the sender's budget.
      if ((await ctx.events.load(aggregateId)).length > 0) return OUTCOME_DUPLICATE;

      const throttle = await chargeSender(ctx, options, tenantId, input.from);
      const requestId = `channel-whatsapp:receive-message:${aggregateId}`;
      const from = await encryptWhatsappPii(
        tenantId,
        throttle ? WhatsappPiiFields.throttledFrom : WhatsappPiiFields.receivedFrom,
        input.from,
        requestId,
      );

      if (throttle) {
        const payload: ThrottledPayload = {
          phoneNumberId: input.phoneNumberId,
          wamid: input.wamid,
          from,
          timestampIso: input.timestampIso,
          retryAfterSeconds: throttle.details.retryAfterSeconds,
        };
        const appended = await ctx.events.tryAppend({
          aggregateId,
          aggregateType: WHATSAPP_MESSAGE_AGGREGATE_TYPE,
          type: WHATSAPP_THROTTLED_EVENT_QN,
          payload,
        });
        return appended.ok ? OUTCOME_THROTTLED : OUTCOME_DUPLICATE;
      }

      const payload: MessageReceivedPayload = {
        phoneNumberId: input.phoneNumberId,
        wamid: input.wamid,
        from,
        timestampIso: input.timestampIso,
        messageType: input.messageType,
        text:
          input.text === null
            ? null
            : await encryptWhatsappPii(
                tenantId,
                WhatsappPiiFields.receivedText,
                input.text,
                requestId,
              ),
        buttonPayload:
          input.buttonPayload === null
            ? null
            : await encryptWhatsappPii(
                tenantId,
                WhatsappPiiFields.receivedButtonPayload,
                input.buttonPayload,
                requestId,
              ),
        contextWamid: input.contextWamid,
        mediaId: input.mediaId,
        mimeType: input.mimeType,
      };
      // A concurrent delivery of the same wamid that won the race counts as a duplicate.
      const appended = await ctx.events.tryAppend({
        aggregateId,
        aggregateType: WHATSAPP_MESSAGE_AGGREGATE_TYPE,
        type: WHATSAPP_MESSAGE_RECEIVED_EVENT_QN,
        payload,
      });
      return appended.ok ? OUTCOME_STORED : OUTCOME_DUPLICATE;
    },
  });
}

export function createRecordStatusHandler(options: ResolvedWhatsappOptions) {
  return defineWriteHandler({
    name: "record-status",
    schema: recordStatusInputSchema,
    access: { roles: ["SystemAdmin"] },
    rateLimit: options.rateLimit,
    agent: { expose: false },
    description:
      "Stores one delivery status (sent, delivered, read, failed) of an outbound WhatsApp message as a status-updated event; a repeated status of the same wamid is a duplicate.",
    handler: async (event, ctx) => {
      const input = event.payload;
      const tenantId = event.user.tenantId;
      const aggregateId = whatsappStatusAggregateId(
        tenantId,
        input.wamid,
        input.status,
        input.rawStatus,
      );
      if ((await ctx.events.load(aggregateId)).length > 0) return OUTCOME_DUPLICATE;

      const payload: StatusUpdatedPayload = {
        phoneNumberId: input.phoneNumberId,
        wamid: input.wamid,
        status: input.status,
        timestampIso: input.timestampIso,
        recipient: await encryptWhatsappPii(
          tenantId,
          WhatsappPiiFields.statusRecipient,
          input.recipient,
          `channel-whatsapp:record-status:${aggregateId}`,
        ),
        errorCode: input.errorCode,
      };
      const appended = await ctx.events.tryAppend({
        aggregateId,
        aggregateType: WHATSAPP_STATUS_AGGREGATE_TYPE,
        type: WHATSAPP_STATUS_UPDATED_EVENT_QN,
        payload,
      });
      return appended.ok ? OUTCOME_STORED : OUTCOME_DUPLICATE;
    },
  });
}
