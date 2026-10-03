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

import * as z from "zod";
import { BILLING_FOUNDATION_FEATURE, SubscriptionStatuses } from "./constants.js";

// Aggregate-type für den event-store. Eine subscription pro Tenant ist
// ein stream; der subscriptionAggregateId-helper liefert die stream-id.
export const SUBSCRIPTION_AGGREGATE_TYPE = "subscription" as const;

// Event-name-Konstanten — short-form (für r.defineEvent) + qualifizierte
// FQN (für ctx.unsafeAppendEvent + projection-apply-keys).
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
  // 1000, not 200: these two are `tenantOwned: true` on the entity (see
  // entities.ts — crypto-shreds on tenant-destroy, unlike `encrypted`).
  // process-event.write.ts stores the PII-ciphertext here, not the raw
  // provider id. A 200-char plaintext id becomes ~300+ chars of ciphertext.
  providerCustomerId: z.string().min(1).max(1000),
  providerSubscriptionId: z.string().min(1).max(1000),
  status: statusEnum,
  tier: z.string().min(1).max(50),
  currentPeriodEndIso: z.string().min(1),
  // Optional (not required): existing events (Mollie-style providers, or
  // events appended before this field existed) stay valid without an
  // upcaster. null = the subscription renews; undefined = the provider
  // doesn't report cancelAt at all — projection.ts tells the two apart.
  cancelAtIso: z.string().min(1).nullable().optional(),
  consentId: z.string().min(1).max(100).optional(),
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

// =============================================================================
// payment-received — one-off-payments (checkout mode "payment")
// =============================================================================
//
// Own aggregate-type + event, separate from the 5 subscription events above.
// A one-off-payment is not a subscription-state transition (no status/tier/
// currentPeriodEnd) — it materializes as its own `read_payments` row (one
// row per payment) via the payment-aggregate stream (one stream per tenant,
// see aggregate-id.ts).

export const PAYMENT_AGGREGATE_TYPE = "payment" as const;

export const PAYMENT_RECEIVED_EVENT_SHORT = "payment-received" as const;
export const PAYMENT_RECEIVED_EVENT_QN =
  `${BILLING_FOUNDATION_FEATURE}:event:${PAYMENT_RECEIVED_EVENT_SHORT}` as const;

export const paymentEventPayloadSchema = z.object({
  providerName: z.string().min(1).max(50),
  // 1000, not 200: `tenantOwned: true` on paymentEntity (see entities.ts) —
  // this stores the PII-ciphertext, not the raw provider id. Mirrors
  // subscriptionEventPayloadSchema's same rationale.
  providerCustomerId: z.string().min(1).max(1000),
  priceId: z.string().min(1).max(200),
  consentId: z.string().min(1).max(100).optional(),
});
export type PaymentEventPayload = z.infer<typeof paymentEventPayloadSchema>;

export type PaymentEventHeaders = {
  readonly providerEventId: string;
  readonly providerName: string;
  readonly rawPayload: string;
};

// =============================================================================
// checkout-consent-recorded — consumer-protection consent
// =============================================================================
//
// Appended onto the subscription- or payment-stream (by checkout mode) after
// the provider handed out the checkout URL. No projection applies it. Carries
// no email or IP: the consenting user is identified by `actorUserId` only.

export const CHECKOUT_CONSENT_RECORDED_EVENT_SHORT = "checkout-consent-recorded" as const;
export const CHECKOUT_CONSENT_RECORDED_EVENT_QN =
  `${BILLING_FOUNDATION_FEATURE}:event:${CHECKOUT_CONSENT_RECORDED_EVENT_SHORT}` as const;

export const checkoutConsentRecordedPayloadSchema = z.object({
  consentId: z.string().min(1).max(100),
  mode: z.enum(["subscription", "payment"]),
  tier: z.string().min(1).max(50).nullable(),
  priceId: z.string().min(1).max(200),
  unitAmount: z.number().nullable(),
  currency: z.string().nullable(),
  interval: z.string().nullable(),
  intervalCount: z.number().nullable(),
  consentTextVersion: z.string().min(1).max(64),
  termsHash: z.string().length(64),
  termsTemplateVersion: z.number(),
  locale: z.string().min(2).max(35),
  actorUserId: z.string().min(1),
});
export type CheckoutConsentRecordedPayload = z.infer<typeof checkoutConsentRecordedPayloadSchema>;

// =============================================================================
// contract-confirmation-issued — § 312f confirmation mail sent
// =============================================================================
//
// Appended onto the stream that carries the consent, BEFORE the mail is
// handed to delivery: the append is the optimistic-concurrency guard that
// keeps a concurrent or replayed run from sending a second mail.

export const CONTRACT_CONFIRMATION_ISSUED_EVENT_SHORT = "contract-confirmation-issued" as const;
export const CONTRACT_CONFIRMATION_ISSUED_EVENT_QN =
  `${BILLING_FOUNDATION_FEATURE}:event:${CONTRACT_CONFIRMATION_ISSUED_EVENT_SHORT}` as const;

export const contractConfirmationIssuedPayloadSchema = z.object({
  consentId: z.string().min(1).max(100),
  issuedAtIso: z.string().min(1),
  locale: z.string().min(2).max(35),
  termsTemplateVersion: z.number(),
});
export type ContractConfirmationIssuedPayload = z.infer<
  typeof contractConfirmationIssuedPayloadSchema
>;

// =============================================================================
// contract-termination-requested / -unmatched — § 312k cancellation
// =============================================================================
//
// Payloads carry no name, email or reason: those only travel in the mails.
// `requested` goes onto the tenant's subscription stream; `unmatched` onto a
// system-tenant stream of its own, keyed by the request id.

export const CONTRACT_TERMINATION_DECLARATION_TYPES = ["termination", "withdrawal"] as const;
export type ContractTerminationDeclarationType =
  (typeof CONTRACT_TERMINATION_DECLARATION_TYPES)[number];
export const CONTRACT_TERMINATION_KINDS = ["ordinary", "extraordinary"] as const;
export type ContractTerminationKind = (typeof CONTRACT_TERMINATION_KINDS)[number];
export const CONTRACT_TERMINATION_CHANNELS = ["public", "account"] as const;
export const PROVIDER_CANCEL_OUTCOMES = ["period-end", "immediately", "none"] as const;
export type ProviderCancelOutcome = (typeof PROVIDER_CANCEL_OUTCOMES)[number];

export const CONTRACT_TERMINATION_REQUESTED_EVENT_SHORT = "contract-termination-requested" as const;
export const CONTRACT_TERMINATION_REQUESTED_EVENT_QN =
  `${BILLING_FOUNDATION_FEATURE}:event:${CONTRACT_TERMINATION_REQUESTED_EVENT_SHORT}` as const;

export const contractTerminationRequestedPayloadSchema = z.object({
  requestId: z.string().min(1).max(100),
  declarationType: z.enum(CONTRACT_TERMINATION_DECLARATION_TYPES),
  terminationKind: z.enum(CONTRACT_TERMINATION_KINDS),
  channel: z.enum(CONTRACT_TERMINATION_CHANNELS),
  receivedAtIso: z.string().min(1),
  effectiveAtIso: z.string().min(1).nullable(),
  providerCancel: z.enum(PROVIDER_CANCEL_OUTCOMES),
});
export type ContractTerminationRequestedPayload = z.infer<
  typeof contractTerminationRequestedPayloadSchema
>;

export const CONTRACT_TERMINATION_UNMATCHED_AGGREGATE_TYPE =
  "contract-termination-unmatched" as const;
export const CONTRACT_TERMINATION_UNMATCHED_EVENT_SHORT = "contract-termination-unmatched" as const;
export const CONTRACT_TERMINATION_UNMATCHED_EVENT_QN =
  `${BILLING_FOUNDATION_FEATURE}:event:${CONTRACT_TERMINATION_UNMATCHED_EVENT_SHORT}` as const;

export const contractTerminationUnmatchedPayloadSchema = z.object({
  requestId: z.string().min(1).max(100),
  declarationType: z.enum(CONTRACT_TERMINATION_DECLARATION_TYPES),
  terminationKind: z.enum(CONTRACT_TERMINATION_KINDS),
  channel: z.literal("public"),
  receivedAtIso: z.string().min(1),
  matchResult: z.enum(["none", "ambiguous"]),
});
export type ContractTerminationUnmatchedPayload = z.infer<
  typeof contractTerminationUnmatchedPayloadSchema
>;
