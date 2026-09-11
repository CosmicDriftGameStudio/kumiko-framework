---
"@cosmicdrift/kumiko-bundled-features": minor
---

fw#2755: `SubscriptionProviderPlugin["createCheckoutSession"]` now accepts an optional `mode: "subscription" | "payment"` field (default `"subscription"`) so a provider can start a one-off checkout (e.g. pay-per-use credit top-ups) instead of a recurring subscription. The `create-checkout-session` write-handler's input schema now accepts an optional `mode` field and passes it through to the plugin, so the field is reachable end-to-end from the public write API, not just the plugin contract. `subscription-stripe` passes `mode` through to `stripe.checkout.sessions.create`, moving the tenant-metadata from `subscription_data` (subscription-mode-only) to `payment_intent_data` when `mode: "payment"`. `subscription-mollie` maps `mode: "payment"` to `sequenceType: "oneoff"` instead of the mandate-setup `"first"`. Existing callers that omit `mode` are unaffected. Webhook resolution for one-off payments is out of scope here (offlot#109).
