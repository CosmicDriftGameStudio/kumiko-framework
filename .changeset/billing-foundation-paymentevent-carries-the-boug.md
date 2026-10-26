---
"@cosmicdrift/kumiko-bundled-features": minor
---

PaymentEvent carries the bought quantity

PaymentEvent.quantity (absent means 1) reaches the stored payment-received event payload, which stays readable for events stored before. Apps that grant credits per pack have to multiply by it. No read-model column.

<!-- kumiko-changes
feature: billing-foundation
type: improvement
title: PaymentEvent carries the bought quantity
-->
