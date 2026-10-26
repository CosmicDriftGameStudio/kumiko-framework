---
"@cosmicdrift/kumiko-bundled-features": minor
---

Add subscription-paddle, a Paddle Billing provider plugin

Checkout via the Paddle.js overlay on a page served by the feature at /billing/paddle-checkout. The Default Payment Link in the Paddle dashboard must point to <APP_BASE_URL>/billing/paddle-checkout; it is the only source, because transactions are created without a checkout url. Create subscription prices in the Paddle catalog with quantity minimum and maximum 1; for one-off packs set the quantity limits on purpose, because the payment event carries quantity and the app has to multiply its credits by it. Also ships customer portal, cancel, resume, batched price lookup, in-app plan switch and tenant binding of checkouts through an HMAC in custom_data.

<!-- kumiko-changes
feature: subscription-paddle
type: improvement
title: Add subscription-paddle, a Paddle Billing provider plugin
-->
