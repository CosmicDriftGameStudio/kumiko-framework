---
"@cosmicdrift/kumiko-bundled-features": patch
---
The stub subscription provider records checkout, portal and plan-switch calls.
<!-- kumiko-changes
feature: billing-foundation
type: improvement
title: Stub subscription provider records its calls
detail: `createStubSubscriptionProvider` from `@cosmicdrift/kumiko-bundled-features/billing-foundation/testing` now returns `calls.checkout`, `calls.portal` and `calls.planSwitch` with the options each provider hook received, plus `resetCalls()`. App tests can assert the price, URLs and tenant of a checkout through the real handlers without writing their own SubscriptionProviderPlugin mock. A hook replaced through `overrides` is not recorded.
-->
