// process-event — programmatic write-handler den der webhook-handler
// (createSubscriptionWebhookHandler) aufruft NACHDEM Plugin den raw-body
// verifiziert + zu SubscriptionEvent normalisiert hat.
//
// **ES-Pattern:**
//   1. Idempotency-check: lädt subscription-stream + scannt nach
//      bereits gesehenem `metadata.providerEventId`. Provider-Replay
//      (Stripe-Retry-Storm) sieht denselben event-id → duplicate=true,
//      kein zweiter append.
//   2. Type-mapping: SubscriptionEvent.type (= normalisiert vom Plugin)
//      → einer der 5 ES-event-typen.
//   3. ctx.appendEventUnsafe — Inline-projection materialisiert die
//      `read_subscriptions`-row in derselben TX.

import type { WriteHandlerDef } from "@kumiko/framework/engine";
import { z } from "zod";
import { subscriptionAggregateId } from "../aggregate-id";
import { SubscriptionEventTypes, SubscriptionStatuses } from "../constants";
import {
  INVOICE_PAID_EVENT_QN,
  INVOICE_PAYMENT_FAILED_EVENT_QN,
  SUBSCRIPTION_AGGREGATE_TYPE,
  SUBSCRIPTION_CANCELED_EVENT_QN,
  SUBSCRIPTION_CREATED_EVENT_QN,
  SUBSCRIPTION_UPDATED_EVENT_QN,
  type SubscriptionEventHeaders,
  type SubscriptionEventPayload,
} from "../events";

// =============================================================================
// Input-Schema = der normalisierte SubscriptionEvent (ohne tenantId, der
// kommt aus event.user.tenantId — der webhook-handler setzt den
// programmatic-user mit der vom Plugin aufgelösten tenantId).
// =============================================================================

const eventTypeSchema = z.enum([
  SubscriptionEventTypes.created,
  SubscriptionEventTypes.updated,
  SubscriptionEventTypes.canceled,
  SubscriptionEventTypes.invoicePaid,
  SubscriptionEventTypes.invoicePaymentFailed,
]);

const statusSchema = z.enum([
  SubscriptionStatuses.active,
  SubscriptionStatuses.trialing,
  SubscriptionStatuses.pastDue,
  SubscriptionStatuses.canceled,
  SubscriptionStatuses.incomplete,
]);

export const processEventSchema = z.object({
  providerEventId: z.string().min(1).max(200),
  providerName: z.string().min(1).max(50),
  type: eventTypeSchema,
  providerCustomerId: z.string().min(1).max(200),
  providerSubscriptionId: z.string().min(1).max(200),
  status: statusSchema,
  tier: z.string().min(1).max(50),
  currentPeriodEndIso: z.string().min(1),
  rawPayload: z.string().min(1),
});
type ProcessEventPayload = z.infer<typeof processEventSchema>;

// Map normalized SubscriptionEventType → fully-qualified ES event-name.
const NORMALIZED_TO_ES_EVENT: Readonly<Record<string, string>> = {
  [SubscriptionEventTypes.created]: SUBSCRIPTION_CREATED_EVENT_QN,
  [SubscriptionEventTypes.updated]: SUBSCRIPTION_UPDATED_EVENT_QN,
  [SubscriptionEventTypes.canceled]: SUBSCRIPTION_CANCELED_EVENT_QN,
  [SubscriptionEventTypes.invoicePaid]: INVOICE_PAID_EVENT_QN,
  [SubscriptionEventTypes.invoicePaymentFailed]: INVOICE_PAYMENT_FAILED_EVENT_QN,
};

// =============================================================================
// Handler
// =============================================================================
//
// SystemAdmin-only: dieser handler wird ausschließlich vom programmatic
// webhook-handler aufgerufen (mit einem internal SystemUser), nie vom
// Tenant-Admin direkt.
export const processEventHandler: WriteHandlerDef = {
  name: "process-event",
  schema: processEventSchema,
  access: { roles: ["SystemAdmin"] },
  handler: async (event, ctx) => {
    // @cast-boundary engine-payload — dispatcher-zod-validated payload
    const payload = event.payload as ProcessEventPayload;
    const tenantId = event.user.tenantId;
    const aggId = subscriptionAggregateId(tenantId);

    // ---------------------------------------------------------------
    // 1. Idempotency: load subscription-stream + check ob dieser
    //    providerEventId bereits gesehen wurde. Provider-Retry-Storm
    //    (Stripe sendet bis zu 5x in 4h) trifft denselben Stream und
    //    findet den event-id in metadata.
    //
    //    **Performance-caveat:** O(N) pro stream. Bei 5 Jahren history
    //    (recurring monatlich = ~60 events) noch <50ms. Bei deutlich
    //    längeren streams optimieren via snapshot oder per-tenant
    //    dedup-table als idempotency-anchor (analog cap-counter).
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
        data: { duplicate: true as const, subscriptionAggregateId: aggId },
      };
    }

    // ---------------------------------------------------------------
    // 2. Map normalized event-type → ES event-FQN.
    // ---------------------------------------------------------------
    const esEventType = NORMALIZED_TO_ES_EVENT[payload.type];
    if (!esEventType) {
      // Schema-validation oben sollte das schon fangen, aber defensive
      // gegen drift im SubscriptionEventTypes-enum vs NORMALIZED-Map.
      throw new Error(`subscription-foundation: no ES event-type mapping for "${payload.type}"`);
    }

    // ---------------------------------------------------------------
    // 3. Append event auf den subscription-stream. Inline-projection
    //    materialisiert die read_subscriptions-row in derselben TX.
    // ---------------------------------------------------------------
    const eventPayload: SubscriptionEventPayload = {
      providerName: payload.providerName,
      providerCustomerId: payload.providerCustomerId,
      providerSubscriptionId: payload.providerSubscriptionId,
      status: payload.status,
      tier: payload.tier,
      currentPeriodEndIso: payload.currentPeriodEndIso,
    };
    const headers: SubscriptionEventHeaders = {
      providerEventId: payload.providerEventId,
      providerName: payload.providerName,
      rawPayload: payload.rawPayload,
    };
    await ctx.appendEventUnsafe({
      aggregateId: aggId,
      aggregateType: SUBSCRIPTION_AGGREGATE_TYPE,
      type: esEventType,
      payload: eventPayload,
      headers,
    });

    return {
      isSuccess: true as const,
      data: {
        duplicate: false as const,
        subscriptionAggregateId: aggId,
      },
    };
  },
};
