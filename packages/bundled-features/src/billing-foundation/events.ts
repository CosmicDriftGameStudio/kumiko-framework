// Domain-events für subscription-foundation.
//
// **Pattern:** event-sourced — jeder Provider-Webhook (nach Plugin-
// verify) wird zu einem domain-event auf dem subscription-stream
// (= ein stream pro Tenant via subscriptionAggregateId(tenantId)).
// Read-model = inline projection in `subscriptions`-Tabelle.
//
// 5 fine-grained event-typen statt einem generic "webhook-received"-
// bucket — events sind business-facts: future-consumer (billing-history,
// accounting-export, churn-analytics) listenen direkt auf den event-
// type ohne payload-discriminator.

import { z } from "zod";
import { BILLING_FOUNDATION_FEATURE, SubscriptionStatuses } from "./constants";

// Aggregate-type für den event-store. Eine subscription pro Tenant ist
// ein stream; der subscriptionAggregateId-helper liefert die stream-id.
export const SUBSCRIPTION_AGGREGATE_TYPE = "subscription" as const;

// Event-name-Konstanten — short-form (für r.defineEvent) + qualifizierte
// FQN (für ctx.appendEventUnsafe + projection-apply-keys).
export const SUBSCRIPTION_CREATED_EVENT_SHORT = "subscription-created" as const;
export const SUBSCRIPTION_UPDATED_EVENT_SHORT = "subscription-updated" as const;
export const SUBSCRIPTION_CANCELED_EVENT_SHORT = "subscription-canceled" as const;
export const INVOICE_PAID_EVENT_SHORT = "invoice-paid" as const;
export const INVOICE_PAYMENT_FAILED_EVENT_SHORT = "invoice-payment-failed" as const;

export const SUBSCRIPTION_CREATED_EVENT_QN =
  `${BILLING_FOUNDATION_FEATURE}:event:${SUBSCRIPTION_CREATED_EVENT_SHORT}` as const;
export const SUBSCRIPTION_UPDATED_EVENT_QN =
  `${BILLING_FOUNDATION_FEATURE}:event:${SUBSCRIPTION_UPDATED_EVENT_SHORT}` as const;
export const SUBSCRIPTION_CANCELED_EVENT_QN =
  `${BILLING_FOUNDATION_FEATURE}:event:${SUBSCRIPTION_CANCELED_EVENT_SHORT}` as const;
export const INVOICE_PAID_EVENT_QN =
  `${BILLING_FOUNDATION_FEATURE}:event:${INVOICE_PAID_EVENT_SHORT}` as const;
export const INVOICE_PAYMENT_FAILED_EVENT_QN =
  `${BILLING_FOUNDATION_FEATURE}:event:${INVOICE_PAYMENT_FAILED_EVENT_SHORT}` as const;

// Status-enum für event-payloads (= subscription-state-snapshot vom Provider).
const statusEnum = z.enum([
  SubscriptionStatuses.active,
  SubscriptionStatuses.trialing,
  SubscriptionStatuses.pastDue,
  SubscriptionStatuses.canceled,
  SubscriptionStatuses.incomplete,
]);

// Common payload — alle 5 events tragen denselben subscription-state-
// snapshot. Event-type tagged was passiert ist, payload den state-after.
// Provider-spezifischer rawPayload ist in metadata.rawPayload (nicht in
// payload — payload ist domain-clean, metadata ist provider-truth).
export const subscriptionEventPayloadSchema = z.object({
  providerName: z.string().min(1).max(50),
  providerCustomerId: z.string().min(1).max(200),
  providerSubscriptionId: z.string().min(1).max(200),
  status: statusEnum,
  tier: z.string().min(1).max(50),
  currentPeriodEndIso: z.string().min(1),
});
export type SubscriptionEventPayload = z.infer<typeof subscriptionEventPayloadSchema>;

// Headers-shape — wird im event-store als event.metadata.headers
// persistiert (open-shape jsonb-column, primitives only).
// Idempotency-anchor: providerEventId pro provider, foundation checked
// vor append ob bereits gesehen. rawPayload ist als string archiviert
// damit Plugin-bug-fix-replays from-source machbar bleiben.
export type SubscriptionEventHeaders = {
  readonly providerEventId: string;
  readonly providerName: string;
  readonly rawPayload: string;
};
