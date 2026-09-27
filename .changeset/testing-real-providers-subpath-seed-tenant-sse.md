---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-testing": minor
---

`requireRealProviders()` is importable from `@cosmicdrift/kumiko-testing/e2e`, and `seedTenant()` tenants receive SSE events on `stack.events.sse`

<!-- kumiko-changes
feature: framework
type: improvement
title: Real-provider helpers under the import-free subpath testing/real-providers
detail: |
  `@cosmicdrift/kumiko-framework/testing/real-providers` exports `requireRealProviders`, `isRealProviderRun` and `REAL_PROVIDERS_ENV` without pulling in the `./testing` barrel and its Bun-only dependencies, so code that loads under Node can use them.
-->

<!-- kumiko-changes
feature: testing
type: improvement
title: requireRealProviders from kumiko-testing/e2e, SSE events for seedTenant tenants
detail: |
  `@cosmicdrift/kumiko-testing/e2e` re-exports `requireRealProviders`, `isRealProviderRun` and `REAL_PROVIDERS_ENV` from the framework's `testing/real-providers` subpath instead of keeping its own copy. Playwright specs and configs, which load under Node, no longer have to avoid the framework's `./testing` barrel.

  `seedTenant(stack, …)` subscribes `stack.events.sse` to the seeded tenant's SSE channel. Before, `setupTestStack` only listened on test tenant 1, so writes in a seeded tenant never showed up on `events.sse` and tests had to call `stack.sseBroker.addClient(tenantChannel(id), …)` themselves; that manual call can go. Events from `persist: true` seeding (tenant, user, membership) now also land on `events.sse` after the next drain.
-->
