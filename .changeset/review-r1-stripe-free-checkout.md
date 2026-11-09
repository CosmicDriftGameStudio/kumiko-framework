---
"@cosmicdrift/kumiko-bundled-features": patch
---

Stripe one-off checkouts that a 100% promo code makes free are booked.

<!-- kumiko-changes
feature: subscription-stripe
type: fix
title: One-off checkouts with a 100% promo code are booked
detail: A Stripe checkout session in payment mode that a 100% promo code makes free is now booked like a paid one: the handler reads the session metadata in payment mode. Sessions created before the upgrade carry no session metadata and are still discarded.
-->
