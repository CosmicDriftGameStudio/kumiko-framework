---
"@cosmicdrift/kumiko-bundled-features": patch
---

Stripe prices with an interval Stripe added after this release now report `intervalCount: null` alongside `interval: null`, and log one warning per price. A `billingPortal.sessions.create` failure during a plan switch is no longer reported as `plan_tiers_share_product`, so the real Stripe error surfaces; only portal-configuration errors map to it. A paid one-off checkout session that is dropped for missing tenant, price or customer data now logs a warning with event and session id.

<!-- kumiko-changes
feature: subscription-stripe
type: fix
title: Stripe unknown price intervals stay consistent, plan-switch errors keep their cause, dropped paid sessions are logged
-->
