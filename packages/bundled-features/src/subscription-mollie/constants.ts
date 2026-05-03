// Feature name
export const SUBSCRIPTION_MOLLIE_FEATURE = "subscription-mollie" as const;

// entityName under den der Plugin gegen "subscriptionProvider"
// registriert. Matcht den path-segment in der webhook-URL
// `/api/subscription/webhook/mollie`.
export const MOLLIE_PROVIDER_NAME = "mollie" as const;

// =============================================================================
// Mollie-Webhook-Pattern (anders als Stripe!)
// =============================================================================
//
// Mollie sendet bei JEDEM event nur die ID im body (form-urlencoded
// oder JSON). Plugin muss IMMER lazy-fetchen via Mollie-API:
//   - `id=tr_xxx`  → payment-id, fetch payment + subscription
//   - `id=sub_xxx` → subscription-id, fetch subscription direkt
//
// **Keine native HMAC-sig-verify** in Mollie-SDK 4.5.0. Mollie's
// Sicherheits-Modell stützt sich auf nicht-guessable IDs (~10^25
// brute-force-space) + API-Lookup-Validation (garbage-id → 401 von
// Mollie-API). Plus: App-Builder kann zusätzlich einen URL-Token-
// Wrapper vor die Foundation-route schalten (eigener extraRoute der
// einen secret-token im URL-Pfad verifiziert + dann an die Foundation
// weiterreicht).
//
// **Event-Type-Mapping** ist heuristisch — Mollie hat keine explicit-
// typed events:
//   - sub_xxx + status=canceled/completed     → SubscriptionEventTypes.canceled
//   - sub_xxx + status=active/pending         → SubscriptionEventTypes.updated
//   - tr_xxx + sequenceType=first + paid      → SubscriptionEventTypes.created
//   - tr_xxx + sequenceType=recurring + paid  → SubscriptionEventTypes.invoicePaid
//   - tr_xxx + sequenceType=recurring + failed → SubscriptionEventTypes.invoicePaymentFailed
//   - alles andere                            → null (foundation 200 ignored)
