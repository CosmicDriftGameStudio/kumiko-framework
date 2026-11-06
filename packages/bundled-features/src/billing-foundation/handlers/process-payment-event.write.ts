// process-payment-event — programmatic write-handler that the webhook-
// handler calls AFTER a plugin has verified a one-off-payment webhook and
// normalized it into a PaymentEvent.
//
// **ES-Pattern (mirrors process-event.write.ts):**
//   1. Idempotency-check: loads the payment-stream and scans for an
//      already-seen `metadata.providerEventId`. A provider-replay with
//      the same event-id → duplicate=true, no second append.
//   2. Ledger check: the payment must name a checkout the server opened itself
//      (same provider, same price); anything else is ignored.
//   3. ctx.events.unsafeAppend — inline-projection materializes a new
//      `read_payments`-row (INSERT-once, not UPSERT — every payment is
//      its own fact, not a state-update).

import {
  configuredPiiSubjectKms,
  encryptPiiFieldValues,
} from "@cosmicdrift/kumiko-framework/crypto";
import type { WriteHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { paymentAggregateId } from "../aggregate-id.ts";
import { findCheckoutOpened, IgnoredEventReasons } from "../checkout-ledger.ts";
import { PAYMENT_PII_FIELDS, paymentEntity } from "../entities.ts";
import {
  PAYMENT_AGGREGATE_TYPE,
  PAYMENT_RECEIVED_EVENT_QN,
  type PaymentEventHeaders,
  type PaymentEventPayload,
  PROVIDER_ID_MAX_CHARS,
} from "../events.ts";
import { hasSeenProviderEvent } from "../provider-event-seen.ts";

export const processPaymentEventSchema = z.object({
  providerEventId: z.string().min(1).max(200),
  providerName: z.string().min(1).max(50),
  providerCheckoutId: z.string().min(1).max(200),
  providerCustomerId: z.string().min(1).max(PROVIDER_ID_MAX_CHARS),
  priceId: z.string().min(1).max(200),
  quantity: z.number().int().positive().optional(),
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
    const existingEvents = await ctx.events.load(aggId);
    if (hasSeenProviderEvent(existingEvents, payload)) {
      return {
        isSuccess: true as const,
        data: { duplicate: true as const, paymentAggregateId: aggId },
      };
    }

    // ---------------------------------------------------------------
    // 2. Ledger: only checkouts this server opened may produce a payment.
    // ---------------------------------------------------------------
    const entry = findCheckoutOpened(existingEvents, {
      providerName: payload.providerName,
      providerCheckoutId: payload.providerCheckoutId,
      mode: "payment",
    });
    const rejection =
      entry === undefined
        ? IgnoredEventReasons.checkoutNotInLedger
        : entry.priceId !== payload.priceId
          ? IgnoredEventReasons.priceMismatch
          : undefined;
    if (rejection !== undefined) {
      ctx.obs.log?.warn(
        `[billing-foundation:process-payment-event] ignored ${payload.providerEventId} (${rejection}): checkout ${payload.providerCheckoutId} of provider ${payload.providerName}`,
      );
      return {
        isSuccess: true as const,
        data: { ignored: true as const, reason: rejection, paymentAggregateId: aggId },
      };
    }

    // ---------------------------------------------------------------
    // 3. Encrypt the provider-subject PII field before it touches storage
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
          { tenantId, entityName: PAYMENT_AGGREGATE_TYPE },
        )
      : { providerCustomerId: payload.providerCustomerId };

    // ---------------------------------------------------------------
    // 4. Append event on the payment-stream. Inline-projection
    //    materializes a new read_payments-row in the same TX.
    // ---------------------------------------------------------------
    const eventPayload: PaymentEventPayload = {
      providerName: payload.providerName,
      providerCustomerId: encryptedFields.providerCustomerId,
      priceId: payload.priceId,
      ...(payload.quantity !== undefined && { quantity: payload.quantity }),
      ...(entry?.consentId !== undefined && { consentId: entry.consentId }),
    };
    const headers: PaymentEventHeaders = {
      providerEventId: payload.providerEventId,
      providerName: payload.providerName,
      providerCheckoutId: payload.providerCheckoutId,
    };
    await ctx.events.unsafeAppend({
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
