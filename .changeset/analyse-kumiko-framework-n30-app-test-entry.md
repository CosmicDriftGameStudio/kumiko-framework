---
"@cosmicdrift/kumiko-dev-server": minor
---

`setupTestStackFromFeatures` is no longer exported; apps test through `setupAppTestStack` from `@cosmicdrift/kumiko-dev-server/testing`.

<!-- kumiko-changes
feature: dev-server
type: breaking
title: setupAppTestStack is the one app test entry
detail: The subpath `@cosmicdrift/kumiko-dev-server/setup-test-stack-from-features` and the root re-exports of `setupTestStackFromFeatures`, `SetupTestStackFromFeaturesOptions` and `TestStackPreset` are removed. Apps use `setupAppTestStack` from `@cosmicdrift/kumiko-dev-server/testing`; packages use `setupTestStack` from `@cosmicdrift/kumiko-testing/stack`.
migration: Replace `setupTestStackFromFeatures(features, options)` with `setupAppTestStack(features, options)` and the type `SetupTestStackFromFeaturesOptions` with `SetupAppTestStackOptions`. setupAppTestStack defaults to `includeBundled: true` and `registryTables: true`; pass `includeBundled: false, registryTables: false` to keep the old defaults.
affects: setupTestStackFromFeatures, setup-test-stack-from-features, SetupTestStackFromFeaturesOptions, TestStackPreset
-->
