---
"@cosmicdrift/kumiko-testing": minor
---

Screenshot scenarios can now seed their own tenant and run a `beforeCapture` hook, so apps no longer have to hardcode screenshots against a shared fixture tenant.

`runScreenshots`/`runMatrix` register their tests on the same `test` as `@cosmicdrift/kumiko-testing/e2e`'s seeded-tenant fixture, so `Scenario.flow` now receives `(page, { seedTenant })` — existing single-parameter `flow(page)` scenarios keep working unchanged. `Scenario.beforeCapture?: (page) => Promise<void>` runs after the viewport is set and the page has settled, right before each screenshot. `seedTenant()`'s "no baseURL" error now only fires when a scenario actually calls it, not for every screenshot spec's fixture setup.

<!-- kumiko-changes
feature: testing
type: improvement
title: Screenshot scenarios get { seedTenant } in flow and a beforeCapture hook; the README no longer recommends a postSave hook on tenant for test defaults
-->
