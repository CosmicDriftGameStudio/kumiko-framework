---
"@cosmicdrift/kumiko-bundled-features": patch
---

Apps get a ready stub subscription provider for e2e and dev seeding instead of writing their own.

<!-- kumiko-changes
feature: billing-foundation
type: improvement
title: Stub subscription provider in billing-foundation/testing
detail: `@cosmicdrift/kumiko-bundled-features/billing-foundation/testing` exports `createStubSubscriptionProvider({ providerName, plans, oneOffPrices?, currency?, overrides? })`. It returns a feature that registers the provider plugin (prices from `plans`, checkout and portal return the given success or return URL, webhooks ignored), `setBillingEnabled(tenantId, enabled)` and `seedSubscription(write, tenantId, { tier, status?, currentPeriodEndIso?, cancelAtIso? })`, which records the checkout and processes the subscription event so the ledger admits it. Pass an e2e seeder's `ctx.write`. Tier sync stays in the app.
-->
