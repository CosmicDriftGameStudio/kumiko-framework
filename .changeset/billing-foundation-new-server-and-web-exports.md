---
"@cosmicdrift/kumiko-bundled-features": minor
---

billing-foundation exports resolveProviderPlugin, isBillingEnabled and the /web QN constants

<!-- kumiko-changes
feature: billing-foundation
type: improvement
title: billing-foundation exports resolveProviderPlugin, isBillingEnabled and the /web QN constants
detail: |
  The server barrel now exports `resolveProviderPlugin`, `isBillingEnabled`
  and the `ResolvedProvider` type, built on internal
  `isPluginBillingEnabled`/`assertBillingEnabled` helpers already used by
  every handler that gates on billing being enabled. An app that
  duplicated this provider-lookup-plus-cast itself (offlot did) can call
  `resolveProviderPlugin`/`isBillingEnabled` instead and drop the cast.

  The `/web` barrel now exports `SubscriptionFoundationHandlers`,
  `SubscriptionFoundationQueries`, `BillingPlanActions`,
  `SubscriptionStatuses`, `BILLING_PLANS_SCREEN_ID` and the
  `BillingPlanBenefit`/`BillingPlanCatalog`/`BillingPlansResult`/
  `BillingPlanView` types. An app that hand-copied these QN constants
  (publicstatus did) can import them from `/web` instead.
-->
