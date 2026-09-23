# @cosmicdrift/kumiko-testing

## 0.298.0

### Minor Changes

- 6735981: createE2eSeedRoutes() returns ExtraRouteDefinition[] instead of an extraRoutes callback

  <!-- kumiko-changes
  feature: testing
  type: breaking
  title: createE2eSeedRoutes() returns ExtraRouteDefinition[] instead of an extraRoutes callback
  migration: |
    createE2eSeedRoutes() now returns readonly ExtraRouteDefinition[] instead of an (app, deps) => void callback. The call site extraRoutes: createE2eSeedRoutes() in setupTestStack is unchanged, but any code that imported createE2eSeedRoutes() to invoke it directly against app (rather than passing it through extraRoutes) must instead treat the result as a route list, e.g. register each entry through the framework's ExtraRouteDefinition handling.
  -->

### Patch Changes

- Updated dependencies [6735981]
- Updated dependencies [6735981]
- Updated dependencies [4ae8163]
- Updated dependencies [6735981]
- Updated dependencies [6735981]
  - @cosmicdrift/kumiko-bundled-features@0.298.0
  - @cosmicdrift/kumiko-dev-server@0.298.0
  - @cosmicdrift/kumiko-framework@0.298.0

## 0.297.0

### Patch Changes

- @cosmicdrift/kumiko-bundled-features@0.297.0
- @cosmicdrift/kumiko-framework@0.297.0
- @cosmicdrift/kumiko-dev-server@0.297.0

## 0.296.0

### Patch Changes

- Updated dependencies [bfa7536]
- Updated dependencies [cb6e8a4]
- Updated dependencies [bfa7536]
- Updated dependencies [42b0562]
- Updated dependencies [f042685]
- Updated dependencies [d8cdd8a]
- Updated dependencies [3c34575]
  - @cosmicdrift/kumiko-bundled-features@0.296.0
  - @cosmicdrift/kumiko-framework@0.296.0
  - @cosmicdrift/kumiko-dev-server@0.296.0

## 0.295.0

### Minor Changes

- 294caec: New package: test template for Kumiko apps

  seedTenant gives each test its own tenant (light by default, persist: true writes real rows through the dispatcher), setupAppTestStack mounts the bundled features and the entity projection tables, the preload subpaths (temporal, ci-log, scrub-env, env, real) replace the per-repo test-setup copies and scrub provider API keys, renderBunfig generates the bunfig variants, and kumiko-testing integration runs the integration files with the 15s budget and opt-in parallelism.

  The `./e2e` subpath is the Playwright core: defineAppE2eConfig fixes parallelism, retries, timeouts and workers centrally, the test fixture seeds a tenant per test through the token-gated `./e2e/seed-route` routes and logs the admin in, and the auth kit (loginViaApi, csrfFetch, createHttpApi, totpCode, waitForProjection) replaces the per-app copies. A SeedPart runs unchanged against the in-process stack and over HTTP.

  The screenshot runner (runScreenshots, runMatrix, pinEnglishLocale) moves in from the samples: `SCREENSHOT_DIR` is required with no default path, so a run can never overwrite the committed docs images, and `screenshotSpecsIgnore()` keeps screenshot specs out of every normal e2e run. Scenarios no longer take `settleMs`; the runner waits until no data request is in flight and the page layout stops changing.

  <!-- kumiko-changes
  feature: testing
  type: improvement
  title: New kumiko-testing package with seedTenant, preloads, bunfig generator and integration runner
  -->

### Patch Changes

- @cosmicdrift/kumiko-framework@0.295.0
- @cosmicdrift/kumiko-bundled-features@0.295.0
- @cosmicdrift/kumiko-dev-server@0.295.0
