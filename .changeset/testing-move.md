---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-testing": minor
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-cli": patch
"create-kumiko-app": patch
"@cosmicdrift/kumiko-dev-server": patch
"@cosmicdrift/kumiko-guards": patch
"@cosmicdrift/kumiko-renderer-mail-html": patch
"@cosmicdrift/kumiko-renderer-puppeteer-client": patch
"@cosmicdrift/kumiko-server-runtime": patch
---

Test stack and test helpers move from kumiko-framework to kumiko-testing; the old framework paths stay as deprecated re-exports

<!-- kumiko-changes
feature: framework
type: improvement
title: Test stack and helpers moved to kumiko-testing, old framework paths are deprecated
detail: |
  Everything a test needs now lives in @cosmicdrift/kumiko-testing. Its core (stack, helpers, preload, bunfig, integration-runner) depends only on kumiko-framework and kumiko-types; bundled-features and dev-server are optional peers used by the root entry and /e2e. Install kumiko-testing as a dev dependency where tests import it.

  The old framework paths re-export the new ones and are removed in the first release after 2026-10-29. Production symbols that tests also use stay in the framework.

  old -> new:
    @cosmicdrift/kumiko-framework/stack -> @cosmicdrift/kumiko-testing/stack
    TestUsers, testTenantId, testUserId, createTestUser from /stack -> @cosmicdrift/kumiko-framework/seeding
    @cosmicdrift/kumiko-framework/testing -> @cosmicdrift/kumiko-testing/helpers
    bridgeStub from /testing and /testing/handler-context -> @cosmicdrift/kumiko-framework/engine
    @cosmicdrift/kumiko-framework/testing/real-providers -> @cosmicdrift/kumiko-testing/helpers/real-providers
    @cosmicdrift/kumiko-framework/testing/e2e-generator -> @cosmicdrift/kumiko-testing/helpers/e2e-generator
migration: Run `bun kumiko-upgrade --apply`. It rewrites imports from the old paths and splits mixed imports by target. Add @cosmicdrift/kumiko-testing to devDependencies where it is missing.
codemod: scripts/codemod/testing-move.ts
-->
