// Feature name
export const SUBSCRIPTION_MOLLIE_FEATURE = "subscription-mollie" as const;

// Entity name under which the plugin registers against
// "subscriptionProvider". Matches the path segment in the webhook URL
// `/api/subscription/webhook/mollie`.
export const MOLLIE_PROVIDER_NAME = "mollie" as const;

// =============================================================================
// Mollie webhook pattern (unlike Stripe)
// =============================================================================
//
// Mollie sends only the ID in the body for EVERY event (form-urlencoded
// or JSON). The plugin must ALWAYS fetch lazily via the Mollie API:
//   - `id=tr_xxx`  → payment ID, fetch payment + subscription
//   - `id=sub_xxx` → subscription ID, fetch subscription directly
//
// **No native HMAC signature verification** in Mollie SDK 4.5.0. Mollie's
// security model relies on non-guessable IDs (~10^25 brute-force space)
// plus API lookup validation (garbage ID → 401 from the Mollie API). In
// addition, the app builder can place a URL-token wrapper before the
// foundation route (a custom extraRoute that verifies a secret token in
// the URL path and then forwards to the foundation).
//
// **Event type mapping** is heuristic—Mollie has no explicitly typed events:
//   - sub_xxx + status=canceled/completed     → SubscriptionEventTypes.canceled
//   - sub_xxx + status=active/pending         → SubscriptionEventTypes.updated
//   - tr_xxx + sequenceType=first + paid      → SubscriptionEventTypes.created
//   - tr_xxx + sequenceType=recurring + paid  → SubscriptionEventTypes.invoicePaid
//   - tr_xxx + sequenceType=recurring + failed → SubscriptionEventTypes.invoicePaymentFailed
//   - everything else                         → null (foundation 200 ignored)
