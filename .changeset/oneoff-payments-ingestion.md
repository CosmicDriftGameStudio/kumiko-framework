---
"@cosmicdrift/kumiko-bundled-features": minor
---

`billing-foundation` and `subscription-stripe` now ingest one-off payments (checkout `mode: "payment"`), not just subscriptions.

- New `PaymentEvent` type, own `payment` aggregate/stream, own `read_payments` projection (one row per payment) — additive, not a sixth `SubscriptionEventTypes` value.
- `SubscriptionProviderPlugin.verifyAndParseWebhook` now returns `SubscriptionEvent | PaymentEvent | null` (was `SubscriptionEvent | null`). No call-site of this function exists in offlot-app, money-horse, or publicstatus today (verified via repo-wide grep), so there is nothing to break in practice; the widening is additionally source-compatible by construction — existing plugin implementations that still return `SubscriptionEvent | null` type-check unchanged (return-type covariance), and `SubscriptionEvent.kind` stays optional so a future consumer reading subscription fields is unaffected too.
- New `billing-foundation:write:process-payment-event` write-handler (same `{ duplicate: boolean }` idempotency contract as `process-event`).
- `subscription-stripe` maps `checkout.session.completed` and `checkout.session.async_payment_succeeded`, guarded by `session.mode === "payment"` and `payment_status === "paid"`, with a lazy `line_items`/`payment_intent` expand for `priceId` and tenant attribution. No new field on the existing `metadata` contract.

Minor bump: purely additive — new exported types/functions, widened (not narrowed) return type, no signature changes to existing exports.
