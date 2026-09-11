// process-payment-event — programmatic write-handler that the webhook-
// handler calls AFTER a plugin has verified a one-off-payment webhook and
// normalized it into a PaymentEvent.
//
// **ES-Pattern (mirrors process-event.write.ts):**
//   1. Idempotency-check: loads the payment-stream and scans for an
//      already-seen `metadata.providerEventId`. A provider-replay with
//      the same event-id → duplicate=true, no second append.
//   2. ctx.unsafeAppendEvent — inline-projection materializes a new
//      `read_payments`-row (INSERT-once, not UPSERT — every payment is
//      its own fact, not a state-update).

import {
  configuredPiiSubjectKms,
  encryptPiiFieldValues,
} from "@cosmicdrift/kumiko-framework/crypto";
import type { WriteHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { paymentAggregateId } from "../aggregate-id";
import { PAYMENT_PII_FIELDS, paymentEntity } from "../entities";
import {
  PAYMENT_AGGREGATE_TYPE,
  PAYMENT_RECEIVED_EVENT_QN,
  type PaymentEventHeaders,
  type PaymentEventPayload,
} from "../events";

export const processPaymentEventSchema = z.object({
  providerEventId: z.string().min(1).max(200),
  providerName: z.string().min(1).max(50),
  providerCustomerId: z.string().min(1).max(200),
  priceId: z.string().min(1).max(200),
  rawPayload: z.string().min(1),
});
type ProcessPaymentEventPayload = z.infer<typeof processPaymentEventSchema>;

// SystemAdmin-only: this handler is called exclusively by the programmatic
// webhook-handler (with an internal SystemUser), never directly by the
// tenant-admin.
export const processPaymentEventHandler: WriteHandlerDef = {
  name: "process-payment-event",
  agent: { expose: false },
  schema: processPaymentEventSchema,
  access: { roles: ["SystemAdmin"] },
  handler: async (event, ctx) => {
    // @cast-boundary engine-payload — dispatcher-zod-validated payload
    const payload = event.payload as ProcessPaymentEventPayload;
    const tenantId = event.user.tenantId;
    const aggId = paymentAggregateId(tenantId);

    // ---------------------------------------------------------------
    // 1. Idempotency: same scan pattern as process-event.write.ts — see
    //    that file's comment for the O(N)-per-stream performance caveat
    //    (a tenant with hundreds of purchases scans hundreds of events;
    //    optimize via a per-tenant providerEventId-index if that bites).
    // ---------------------------------------------------------------
    const existingEvents = await ctx.loadAggregate(aggId);
    const alreadySeen = existingEvents.some((e) => {
      const headers = e.metadata.headers ?? {};
      return (
        headers["providerEventId"] === payload.providerEventId &&
        headers["providerName"] === payload.providerName
      );
    });
    if (alreadySeen) {
      return {
        isSuccess: true as const,
        data: { duplicate: true as const, paymentAggregateId: aggId },
      };
    }

    // ---------------------------------------------------------------
    // 2. Encrypt the provider-subject PII field before it touches storage
    //    — same rationale as process-event.write.ts's step 3.
    // ---------------------------------------------------------------
    const piiKms = configuredPiiSubjectKms();
    const encryptedFields = piiKms
      ? await encryptPiiFieldValues(
          { tenantId, providerCustomerId: payload.providerCustomerId },
          paymentEntity,
          PAYMENT_PII_FIELDS,
          piiKms,
          {
            requestId: `billing-foundation:process-payment-event:${payload.providerEventId}`,
            tenantId,
          },
        )
      : { providerCustomerId: payload.providerCustomerId };

    // ---------------------------------------------------------------
    // 3. Append event on the payment-stream. Inline-projection
    //    materializes a new read_payments-row in the same TX.
    // ---------------------------------------------------------------
    const eventPayload: PaymentEventPayload = {
      providerName: payload.providerName,
      providerCustomerId: encryptedFields["providerCustomerId"] as string,
      priceId: payload.priceId,
    };
    const headers: PaymentEventHeaders = {
      providerEventId: payload.providerEventId,
      providerName: payload.providerName,
      rawPayload: payload.rawPayload,
    };
    await ctx.unsafeAppendEvent({
      aggregateId: aggId,
      aggregateType: PAYMENT_AGGREGATE_TYPE,
      type: PAYMENT_RECEIVED_EVENT_QN,
      payload: eventPayload,
      headers,
    });

    return {
      isSuccess: true as const,
      data: { duplicate: false as const, paymentAggregateId: aggId },
    };
  },
};
