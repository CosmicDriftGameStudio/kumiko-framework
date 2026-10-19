---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-testing": minor
"@cosmicdrift/kumiko-dev-server": minor
"@cosmicdrift/kumiko-dispatcher-live": patch
"@cosmicdrift/kumiko-server-runtime": patch
"@cosmicdrift/kumiko-renderer-mail-html": patch
---

kumiko-testing no longer reaches into bundled-features or dev-server. The functions that need them (`setupAppTestStack`, `seedTenant`, `persistTenantRows`, `createE2eSeedRoutes`) are bound in the new `@cosmicdrift/kumiko-dev-server/testing` subpath, so the testing package has no optional peers left. Framework tests that exercised dispatcher-live, dev-server or the tier engine moved into the packages they test, and `scripts/check-package-cycles.ts` checks the package graph.

<!-- kumiko-changes
feature: testing
type: breaking
title: Test stack and seed helpers moved to @cosmicdrift/kumiko-dev-server/testing
detail: setupAppTestStack, SetupAppTestStackOptions, seedTenant, persistTenantRows and createE2eSeedRoutes are no longer exported from @cosmicdrift/kumiko-testing; the bundled-features and dev-server optional peers are gone.
migration: Import the five names from @cosmicdrift/kumiko-dev-server/testing and add @cosmicdrift/kumiko-dev-server to your dependencies; run bun kumiko-upgrade --apply to rewrite the imports. Namespace imports are listed as manual.
codemod: scripts/codemod/testing-injection.ts
-->

<!-- kumiko-changes
feature: dev-server
type: improvement
title: ./testing subpath with the bound test stack and seed helpers
detail: setupAppTestStack, seedTenant, persistTenantRows and createE2eSeedRoutes, wired to the bundled user, tenant and auth features.
-->
