---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-framework": patch
---

Option validation in the bundled-feature factories now throws typed boot rule errors. 59 `create*Feature()` and boot-check throw sites across 19 features and one shared helper (billing-foundation, host-routing, metrics, legal-pages, template-resolver, subscription-mollie and more) get 36 rule ids, so `agents/boot-rules.md` lists them with summary and fix.

<!-- kumiko-changes
feature: framework
type: improvement
title: Bundled-feature factory options fail with boot rule ids
detail: Invalid factory options (`createBillingFoundationFeature` baseUrl and consumerProtection, `createHostDispatch` redirects and locales, `createMetricsFeature` duplicate ids, `createTemplateResolverFeature` tenantEditable, `createSubscriptionMollieFeature` price maps, empty `parents` allowlists on folders, tags and notes-history, and the tenant, readiness and personal-access-tokens boot checks) now throw a `BootRuleViolation` (a subclass of `Error`) carrying `rule.id`. Example ids: `billing-foundation/base-url-required`, `host-routing/invalid-redirect`, `subscription-mollie/price-map-drift`, `template-resolver/tenant-editable-duplicate`, `shared/where-rule-in-ownership-write`. Messages, conditions and the fail-fast behaviour at the same place are unchanged.
-->
