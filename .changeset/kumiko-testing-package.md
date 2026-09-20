---
"@cosmicdrift/kumiko-testing": minor
---

New package: test template for Kumiko apps

seedTenant gives each test its own tenant (light by default, persist: true writes real rows through the dispatcher), setupAppTestStack mounts the bundled features and the entity projection tables, the preload subpaths (temporal, ci-log, scrub-env, env, real) replace the per-repo test-setup copies and scrub provider API keys, renderBunfig generates the bunfig variants, and kumiko-testing integration runs the integration files with the 15s budget and opt-in parallelism.

The `./e2e` subpath is the Playwright core: defineAppE2eConfig fixes parallelism, retries, timeouts and workers centrally, the test fixture seeds a tenant per test through the token-gated `./e2e/seed-route` routes and logs the admin in, and the auth kit (loginViaApi, csrfFetch, createHttpApi, totpCode, waitForProjection) replaces the per-app copies. A SeedPart runs unchanged against the in-process stack and over HTTP.

The screenshot runner (runScreenshots, runMatrix, pinEnglishLocale) moves in from the samples: `SCREENSHOT_DIR` is required with no default path, so a run can never overwrite the committed docs images, and `screenshotSpecsIgnore()` keeps screenshot specs out of every normal e2e run. Scenarios no longer take `settleMs`; the runner waits until no data request is in flight and the page layout stops changing.

<!-- kumiko-changes
feature: testing
type: improvement
title: New kumiko-testing package with seedTenant, preloads, bunfig generator and integration runner
-->
