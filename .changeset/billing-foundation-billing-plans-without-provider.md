---
"@cosmicdrift/kumiko-bundled-features": minor
---

billing-plans no longer throws when no provider is mounted

<!-- kumiko-changes
feature: billing-foundation
type: improvement
title: billing-plans no longer throws when no provider is mounted
detail: |
  billing-plans now resolves the catalog's provider through a new
  `findCatalogProvider` (returns `null` instead of throwing) and returns
  `{ enabled: false, ... }` when none is mounted, instead of failing the
  whole query with UnconfiguredError. Apps that mounted Stripe with an
  empty price map purely to keep this query alive can drop that
  workaround. An ambiguous catalog (more than one matching provider
  mounted) still throws UnconfiguredError — that case didn't change.
-->

<!-- kumiko-changes
feature: billing-foundation
type: breaking
title: start-plan-checkout and switch-plan reject with FeatureDisabledError, not UnconfiguredError, when no provider is mounted
migration: |
  start-plan-checkout and switch-plan now reject with FeatureDisabledError
  (code "feature_disabled", HTTP 403) instead of UnconfiguredError (code
  "unconfigured", HTTP 422) when no provider is mounted for the catalog. A
  caller that specifically catches UnconfiguredError from these two
  handlers, or branches on the 422 status, must catch FeatureDisabledError
  / branch on 403 instead.
-->
