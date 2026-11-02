---
"@cosmicdrift/kumiko-bundled-features": patch
---

The Paddle webhook only turns a completed one-off transaction into a payment event when its price is in `oneOffPriceIds`.

<!-- kumiko-changes
feature: subscription-paddle
type: fix
title: paddle webhook drops one-off payments for prices outside oneOffPriceIds
detail: `transaction.completed` became a payment event for any price with a valid tenant binding. Paddle.js can open a checkout in the browser with arbitrary customData and price, so the server-side `oneOffPriceIds` / `authorizeOneOffCheckout` gate was bypassable. `PaddleWebhookOptions` now takes `oneOffPriceIds` (the feature passes `options.oneOffPriceIds ?? []`) and an event for any other price is dropped with a warning carrying only the provider event id and price id. Apps selling one-off credits must list those prices in `oneOffPriceIds`.
-->
