# @cosmicdrift/kumiko-testing

## 0.313.0

### Patch Changes

- Updated dependencies [773c52f]
- Updated dependencies [a14fd1f]
- Updated dependencies [4aa0c98]
- Updated dependencies [42c5298]
- Updated dependencies [16c81b9]
- Updated dependencies [f0c1ef1]
- Updated dependencies [93d7b77]
- Updated dependencies [4dea3ec]
- Updated dependencies [09a9148]
- Updated dependencies [b99240c]
- Updated dependencies [e7dc624]
  - @cosmicdrift/kumiko-bundled-features@0.313.0
  - @cosmicdrift/kumiko-framework@0.313.0
  - @cosmicdrift/kumiko-dev-server@0.313.0

## 0.312.0

### Patch Changes

- Updated dependencies [f662b79]
- Updated dependencies [b2d00cf]
- Updated dependencies [1799c20]
- Updated dependencies [f662b79]
- Updated dependencies [f662b79]
- Updated dependencies [f662b79]
  - @cosmicdrift/kumiko-bundled-features@0.312.0
  - @cosmicdrift/kumiko-framework@0.312.0
  - @cosmicdrift/kumiko-dev-server@0.312.0

## 0.311.0

### Minor Changes

- c448d50: Screenshot runs render at deviceScaleFactor 2 (fw#3118)

  <!-- kumiko-changes
  feature: testing
  type: breaking
  title: defineAppE2eConfig's chromium project renders screenshot runs at deviceScaleFactor 2
  detail: |
    With SCREENSHOT_DIR set, the chromium project renders at 2x so runMatrix and
    captureScreenshot images stay sharp on HiDPI displays (desktop files are
    3840×2160). Plain e2e runs stay at 1x. Device projects keep their own scale.
  migration: |
    Drop app-level deviceScaleFactor overrides (test.use or project use).
    Committed screenshots taken in the chromium project regenerate at 2x.
  -->

### Patch Changes

- @cosmicdrift/kumiko-framework@0.311.0
- @cosmicdrift/kumiko-bundled-features@0.311.0
- @cosmicdrift/kumiko-dev-server@0.311.0

## 0.310.0

### Minor Changes

- da6c84f: E2E default viewport is 1920×1080 (fw#3118)

  <!-- kumiko-changes
  feature: testing
  type: breaking
  title: defineAppE2eConfig's chromium project runs at 1920×1080 instead of Desktop Chrome's 1280×720
  detail: |
    The template took Playwright's "Desktop Chrome" device unchanged, so every
    e2e run and every inline captureScreenshot rendered at 1280×720 while
    runMatrix's desktop screenshots used 1920×1080. Both now share
    DESKTOP_VIEWPORT (1920×1080). A root `use.viewport` override in an app's
    playwright config never reached the chromium project anyway (project `use`
    wins), so solon's 1920 override was silently ineffective.
  migration: |
    Drop app-level desktop viewport overrides. Specs asserting a layout that
    only exists below 1920px (collapsed sidebar, stacked panes) set their own
    viewport via test.use({ viewport }). Committed inline screenshots taken
    in the chromium project regenerate at 1920 width.
  -->

### Patch Changes

- 70fd8d6: `captureScreenshot(page, name, { fit })` (fw#3118)

  <!-- kumiko-changes
  feature: testing
  type: improvement
  title: captureScreenshot accepts fit viewport, fullPage or content
  detail: |
    `fit: "viewport"` (default) keeps the previous behaviour. `fit: "fullPage"`
    captures the whole document, so offlot's inline mid-flow shots
    (channel-request, channel-prompts, vehicle-channel-texts) can move to
    captureScreenshot. `fit: "content"` grows the viewport until neither the
    document nor a visible overflow-auto/scroll container (WorkspaceShell's
    inner scroll area) overflows, captures, and restores the viewport; it
    throws instead of writing a cropped image when growth does not converge
    within 4 rounds. A 1px container overflow counts as sub-pixel rounding
    (overflow-x-auto table wrappers), not content. This replaces solon's own `e2e/_helpers/shot.ts`; its
    images pick up the `reducedMotion: "reduce"` default on the switch, so a
    one-time pixel drift in the handbook PNGs is expected.
  -->

- ff05fae: `defineAppE2eConfig`'s webServer env no longer defaults `MEILI_URL`/`MEILI_MASTER_KEY`

  <!-- kumiko-changes
  feature: testing
  type: fix
  title: defineAppE2eConfig's webServer env no longer defaults MEILI_URL and MEILI_MASTER_KEY
  detail: |
    Since the infra env defaults landed, every e2e webServer got
    MEILI_URL=http://localhost:17700. Apps that choose Meilisearch over
    their in-memory search adapter when MEILI_URL is set then pointed at an
    unreachable host in CI without a Meili service. Meili is opt-in again:
    the two vars reach the webServer only when the environment sets them or
    the app passes them via `env`. All other infra defaults are unchanged.
    Migration: an app whose e2e needs Meilisearch sets MEILI_URL (and
    MEILI_MASTER_KEY) in `defineAppE2eConfig({ env })` or in the CI env; an
    app that worked around it with `MEILI_URL: ""` can drop that override.
  -->

- 9f16c3f: Screenshot scenario `waitFor` uses the template timeout budget (fw#3118)

  <!-- kumiko-changes
  feature: testing
  type: fix
  title: Screenshot scenario waitFor uses the template timeout budget instead of a fixed 10s
  detail: |
    runScreenshots/runMatrix wait for a scenario's `waitFor` selector with
    `E2E_TIMEOUT_MS.navigation`, or `E2E_TIMEOUT_MS.real` under
    KUMIKO_REAL_PROVIDERS=1, so real-provider screenshot scenarios no longer
    time out on LLM/OCR latency and apps don't need their own wait timeouts.
  -->

- Updated dependencies [a2c9e30]
- Updated dependencies [4f36c3f]
  - @cosmicdrift/kumiko-bundled-features@0.310.0
  - @cosmicdrift/kumiko-framework@0.310.0
  - @cosmicdrift/kumiko-dev-server@0.310.0

## 0.309.0

### Minor Changes

- 621c4de: `captureScreenshot(page, name)` for mid-flow E2E screenshots; `reducedMotion: "reduce"` is now the default (fw#3118)

  <!-- kumiko-changes
  feature: testing
  type: breaking
  title: reducedMotion defaults to "reduce" in runScreenshots/runMatrix/captureScreenshot; captureScreenshot(page, name) added
  detail: |
    rAF-driven chart/tween animations were invisible to the settle-detection
    wait, so screenshots sometimes captured a mid-animation frame. Both matrix
    helpers now call page.emulateMedia({ reducedMotion: "reduce" }) at test
    start, before the first navigation. The new captureScreenshot(page, name,
    opts?) applies the same media emulation at capture time, so it only affects
    animations started after that point; set reducedMotion via test.use() for
    mid-flow shots of charts that animate on mount. captureScreenshot reuses the
    matrix runner's settle logic, writes $SCREENSHOT_DIR/<name>.png, and is a
    no-op when SCREENSHOT_DIR is unset, for solon's mid-flow shot(page, id) and
    offlot's inline page.screenshot writes into docs/screenshots/e2e/.
  migration: |
    Pass `reducedMotion: "no-preference"` in runScreenshots/runMatrix's
    options, or as captureScreenshot's third argument, for a scenario that
    must keep real motion.
  -->

- 621c4de: `runMatrix` locales are app-injectable, and it gains a named-device project mode (fw#3118)

  <!-- kumiko-changes
  feature: testing
  type: improvement
  title: runMatrix locales are app-injectable via localeTags, and gains a namedDevice mode for phone-style device projects
  detail: |
    runMatrix's locale list was fixed to en/de with hardcoded BCP47 tags.
    opts.localeTags lets an app supply its own locale -> tag map (e.g. "es" ->
    "es-ES"); locales with neither an app override nor the en/de default fall
    back to Intl.Locale(locale).maximize().region derivation, throwing only
    when no tag is derivable. A Playwright project whose name isn't a
    ViewportId but is a mobile/device project (offlot's "phone" project) now
    gets its own namedDevice output subtree
    (<dir>/<outputPrefix>/<name>/<locale>/<theme>/<viewport>.png) fixed to the mobile
    viewport, instead of incorrectly falling through to the desktop pass.
  -->

- 95a595d: Screenshot scenarios get the matrix locale in `flow` and a screenshot-only `captureStyle` (fw#3118)

  <!-- kumiko-changes
  feature: testing
  type: improvement
  title: Scenario flow receives runMatrix's locale; Scenario.captureStyle for screenshot-only CSS
  detail: |
    runMatrix passes the current locale to `flow(page, { seedTenant, locale })`,
    so apps whose routes carry the locale in the path (offlot's public vehicle
    page) can build the URL per locale. `captureStyle` is handed to Playwright's
    screenshot `style` option in runScreenshots and runMatrix: the CSS applies
    to the capture only and does not leak into the next theme × viewport shot.
  -->

- 837b712: `seedTenant` accepts an admin identity (displayName/email) for demo and screenshot tenants (fw#3118)

  <!-- kumiko-changes
  feature: testing
  type: improvement
  title: seedTenant accepts an admin identity (displayName/email) for demo and screenshot tenants
  detail: |
    SeedTenantOptions gained an optional `admin: { displayName?, email? }`.
    email supports a `{tenantId}` placeholder, substituted per call, so a
    fixed template (e.g. `admin+{tenantId}@example.test`) stays unique across
    the global `read_users_email_unique` index instead of colliding across
    per-scenario tenants. Threaded through both the plain seed-tenant.ts path
    and the HTTP seed route/fixture.
  -->

### Patch Changes

- 711de11: `test:real` now filters to `*.real.test.ts`, and real-provider runs share one 240s timeout budget (fw#3118)

  <!-- kumiko-changes
  feature: testing
  type: fix
  title: test:real now filters to *.real.test.ts, and real-provider runs share one 240s timeout budget
  detail: |
    bunfig.real.toml's pathIgnorePatterns is blacklist-only (no gitignore-style
    negation), so an unfiltered `bun test --config=bunfig.real.toml` still ran
    the whole unit suite under the real-provider env. The generated `test:real`
    script now passes a positional `real.test.ts` filter. TEST_TIMEOUT_MS.real
    (bun --timeout) and E2E_TIMEOUT_MS.real (the Playwright real-run path via
    defineAppE2eConfig) now both come from the same 240_000 template constant
    instead of a separately hardcoded 120s, covering solon's real-provider
    document-onboarding flow. `isRealProviderRun(env?)` is exported next to
    `REAL_PROVIDERS_ENV`/`requireRealProviders` so apps stop duplicating the
    `KUMIKO_REAL_PROVIDERS === "1"` literal.
  -->

- 711de11: `defineAppE2eConfig`'s webServer env now defaults the infra service vars, environment wins (fw#3118)

  <!-- kumiko-changes
  feature: testing
  type: fix
  title: defineAppE2eConfig's webServer env now defaults the infra service vars, environment wins
  detail: |
    webServer.env is now built as `{ ...infraEnvDefaults(), ...PLAYWRIGHT_DEMO_ENV, ...env }`,
    where infraEnvDefaults() reads the same SERVICE_ENV_DEFAULTS the app's own
    preload uses (DATABASE_URL, REDIS_URL, MEILI_URL, MINIO_*, ...), falling
    back to each default only when process.env doesn't already carry a value.
    A CI/shell-set env var still wins over the template default. No
    `--env-file` is loaded here.
  -->

- Updated dependencies [75925be]
- Updated dependencies [cb0adcf]
- Updated dependencies [11b6f67]
- Updated dependencies [ac9bdae]
- Updated dependencies [a81c5d0]
- Updated dependencies [8f109b5]
- Updated dependencies [711de11]
  - @cosmicdrift/kumiko-framework@0.309.0
  - @cosmicdrift/kumiko-bundled-features@0.309.0
  - @cosmicdrift/kumiko-dev-server@0.309.0

## 0.308.0

### Patch Changes

- 1b64375: `createKumikoServer` can now build its client bundle prod-shaped (splitting, no sourcemap, `NODE_ENV=production`) behind the opt-in `KUMIKO_DEV_PROD_BUNDLES` env var — `bun dev` is unaffected. `defineAppE2eConfig` sets it for the Playwright web server, so E2E now exercises the bundle shape that actually ships instead of a single dev bundle with React's development build, every lazy chunk inlined and a regenerated sourcemap per boot (publicstatus admin: 2.2 MB + 9.2 MB map → 0.87 MB entry; E2E suite −15 % on a 1.5 CPU runner).

  <!-- kumiko-changes
  feature: dev-server
  type: improvement
  title: Dev server can build prod-shaped client bundles, E2E uses them
  -->

- 1b64375: `resolveE2eWorkers` defaulted to a minimum of 2 workers. On a 1.5 CPU CI pod (publicstatus, 59 E2E tests) 1/2/4 workers measured 2.6/2.6/2.7 minutes — the runner is already CPU-saturated at 1 worker, so a higher minimum only adds scheduling overhead. The floor is now 1.

  <!-- kumiko-changes
  feature: testing
  type: fix
  title: E2E default worker count no longer floors at 2
  -->

- 765f01b: `defineAppE2eConfig` derived its default worker count from `os.cpus()`, which reports the host's cores inside a CPU-limited container. CI runner pods capped at 1.5 CPU therefore started 4 Playwright workers, so heavier apps hit the 30s test timeout. The default now uses `os.availableParallelism()`, which honours the cgroup CPU quota.

  <!-- kumiko-changes
  feature: testing
  type: fix
  title: E2E worker default respects the container CPU limit
  -->

- 685ecc9: `import { z } from "zod"` pulled the whole zod namespace — including all 63 locales and the json-schema module — into every client bundle that imported it (359 KB in a publicstatus admin bundle). All framework packages now use `import * as z from "zod"`, which Bun.build can tree-shake (a probe bundle went from 264 KB to 67 KB). A new Biome rule (`noRestrictedImports` on `packages/*/src/**`) keeps `{ z }` from coming back.

  <!-- kumiko-changes
  feature: framework
  type: fix
  title: zod namespace import lets client bundles tree-shake unused locales
  -->

- Updated dependencies [1b64375]
- Updated dependencies [49e07f5]
- Updated dependencies [ad701ed]
- Updated dependencies [6e5ed00]
- Updated dependencies [6e5ed00]
- Updated dependencies [3ae4b82]
- Updated dependencies [9816d20]
- Updated dependencies [6b8b0ed]
- Updated dependencies [6e5ed00]
- Updated dependencies [685ecc9]
  - @cosmicdrift/kumiko-dev-server@0.308.0
  - @cosmicdrift/kumiko-framework@0.308.0
  - @cosmicdrift/kumiko-bundled-features@0.308.0

## 0.307.0

### Patch Changes

- bc6fd32: `seedTenant().loginAs` now switches users via `clearSession(page)` instead of a bare `clearCookies()`, so the page still open on the previous session can no longer redirect to `/login?next=…` and race the new login.

  <!-- kumiko-changes
  feature: testing
  type: fix
  title: seedTenant loginAs switches users via clearSession
  -->

- Updated dependencies [cc23d3d]
- Updated dependencies [0ce171d]
- Updated dependencies [a3f00b0]
- Updated dependencies [c5c5ddb]
- Updated dependencies [e682776]
- Updated dependencies [cc23d3d]
- Updated dependencies [4179f26]
- Updated dependencies [aae3f5d]
  - @cosmicdrift/kumiko-bundled-features@0.307.0
  - @cosmicdrift/kumiko-dev-server@0.307.0
  - @cosmicdrift/kumiko-framework@0.307.0

## 0.306.0

### Minor Changes

- 0d5eef7: `GET /__test/inbox` and `mailCapture` now read tenantless mail (signup, forgot-password, magic-link) from an app's raw `createInMemoryTransport()` outbox, not just `mailTransportInMemoryFeature`'s per-tenant buffer.

  `inboxQuerySchema`'s `tenantId` is now optional (`to` stays required). `createE2eSeedRoutes({ mailOutbox })` accepts `{ readonly sent: readonly EmailMessage[] }` — an app's raw transport passed through as-is. The route reads both sources when both are configured, filters each by `to` (case-insensitive), and returns the tenant buffer before the outbox, each **newest first**; two mails to the same address no longer come back oldest-first. With neither `mailTransportInMemoryFeature`+`tenantId` nor `mailOutbox` available, the route now names both ways to fix it in its 501.

  `mailCapture(request, tenantId, to)` returning `Promise<CapturedMail[]>` is now `mailCapture(request, to, { tenantId?, match? })` returning `Promise<CapturedMail>` — the first mail in that order matching `to` (and `match`, if given), i.e. the newest one per source.

  <!-- kumiko-changes
  feature: testing
  type: breaking
  title: mailCapture and the /__test/inbox route read tenantless mail via a new mailOutbox option
  detail: |
    Apps sending Dev/E2E mail through a raw createInMemoryTransport() (signup,
    forgot-password, magic-link — flows with no tenant) had no way to read it
    through the seed inbox route, which required tenantId and only checked
    mailTransportInMemoryFeature's per-tenant buffer. createE2eSeedRoutes()
    now accepts mailOutbox: { sent: readonly EmailMessage[] } (the raw
    transport's own array); inboxQuerySchema's tenantId is optional. The route
    reads whichever source(s) are configured, filters by to, and returns each
    source newest-first instead of oldest-first.
  migration: |
    mailCapture(request, tenantId, to) -> mailCapture(request, to, { tenantId }),
    and it now resolves to a single CapturedMail (the newest match) instead of
    a readonly CapturedMail[]. Pass match: (mail) => boolean to pick a mail
    other than the newest at that address. Apps with their own ungated debug
    route for a raw transport (e.g. /_debug/mails.json) pass that transport as
    createE2eSeedRoutes({ mailOutbox: transport }) and delete the app-local
    route; tenantId becomes optional wherever only mailOutbox is used. Any
    direct reader of GET /__test/inbox must expect newest-first ordering.
  -->

- 7d17b0e: `runMatrix` now supports real device emulation: a Playwright project named after a viewport id (`desktop`, `tablet`, `mobile`) with `use.isMobile: true` captures exactly `<name>.png` at the device's native size instead of looping `setViewportSize`, which would destroy the emulation. Any other project still runs the desktop pass, skipping the viewport ids a device project already covers. Without device projects, nothing changes. `SCREENSHOT_VIEWPORTS` filters both — a filtered-out device project's test is skipped with a reason, not run empty. Device projects using a WebKit device need `bunx playwright install webkit` in CI.

  <!-- kumiko-changes
  feature: testing
  type: improvement
  title: runMatrix supports device-emulation Playwright projects for real native-size screenshots
  -->

### Patch Changes

- 0d5eef7: New `clearSession(page)` in `@cosmicdrift/kumiko-testing/e2e`: navigates to `about:blank` before clearing cookies. Clearing cookies while an app page is still open lets that page redirect itself to `/login?next=…` on its next request, racing the test's next navigation (flaky session switches at 4 workers). `loginViaUi` now uses it. Apps replace `page.context().clearCookies()` with `clearSession(page)`.

  <!-- kumiko-changes
  feature: testing
  type: improvement
  title: clearSession(page) for race-free session switches in E2E
  -->

- Updated dependencies [b43fe63]
- Updated dependencies [8b4d672]
- Updated dependencies [fdf9377]
- Updated dependencies [499b9c2]
- Updated dependencies [4f96ced]
- Updated dependencies [2e332a3]
- Updated dependencies [5785f57]
- Updated dependencies [cb31fad]
- Updated dependencies [b43fe63]
- Updated dependencies [cbbbb19]
- Updated dependencies [946f7e7]
- Updated dependencies [c6013bd]
- Updated dependencies [b43fe63]
- Updated dependencies [659c575]
- Updated dependencies [946f7e7]
  - @cosmicdrift/kumiko-bundled-features@0.306.0
  - @cosmicdrift/kumiko-framework@0.306.0
  - @cosmicdrift/kumiko-dev-server@0.306.0

## 0.305.0

### Patch Changes

- c41c201: E2E webserver builds Tailwind CSS once instead of running a `--watch` process

  `defineAppE2eConfig` sets `KUMIKO_DEV_STYLESHEET_WATCH=0`, so the dev-server it boots builds CSS once and stops instead of keeping a Tailwind `--watch` process alive. Tailwind v4's watcher subscribes to the whole app cwd recursively with no gitignore filter, so every Playwright artifact write under `test-results/` previously counted as a rebuild trigger.

  <!-- kumiko-changes
  feature: dev-server
  type: improvement
  title: createKumikoServer/runDevApp gain stylesheetWatch (env KUMIKO_DEV_STYLESHEET_WATCH=0) to build Tailwind CSS once without a --watch process
  -->

  <!-- kumiko-changes
  feature: testing
  type: fix
  title: defineAppE2eConfig starts the E2E web server without a Tailwind --watch process, so Playwright artifact writes no longer trigger hundreds of CSS rebuilds
  -->

- Updated dependencies [90c5398]
- Updated dependencies [9de2cde]
- Updated dependencies [c41c201]
- Updated dependencies [05b87d7]
- Updated dependencies [0ee6000]
- Updated dependencies [0567906]
- Updated dependencies [d98d172]
- Updated dependencies [d42d76a]
  - @cosmicdrift/kumiko-framework@0.305.0
  - @cosmicdrift/kumiko-bundled-features@0.305.0
  - @cosmicdrift/kumiko-dev-server@0.305.0

## 0.304.0

### Minor Changes

- e19227b: Screenshot scenarios can now seed their own tenant and run a `beforeCapture` hook, so apps no longer have to hardcode screenshots against a shared fixture tenant.

  `runScreenshots`/`runMatrix` register their tests on the same `test` as `@cosmicdrift/kumiko-testing/e2e`'s seeded-tenant fixture, so `Scenario.flow` now receives `(page, { seedTenant })` — existing single-parameter `flow(page)` scenarios keep working unchanged. `Scenario.beforeCapture?: (page) => Promise<void>` runs after the viewport is set and the page has settled, right before each screenshot. `seedTenant()`'s "no baseURL" error now only fires when a scenario actually calls it, not for every screenshot spec's fixture setup.

  <!-- kumiko-changes
  feature: testing
  type: improvement
  title: Screenshot scenarios get { seedTenant } in flow and a beforeCapture hook; the README no longer recommends a postSave hook on tenant for test defaults
  -->

### Patch Changes

- @cosmicdrift/kumiko-framework@0.304.0
- @cosmicdrift/kumiko-bundled-features@0.304.0
- @cosmicdrift/kumiko-dev-server@0.304.0

## 0.303.0

### Patch Changes

- Updated dependencies [3d28528]
  - @cosmicdrift/kumiko-framework@0.303.0
  - @cosmicdrift/kumiko-bundled-features@0.303.0
  - @cosmicdrift/kumiko-dev-server@0.303.0

## 0.302.0

### Patch Changes

- Updated dependencies [deede20]
  - @cosmicdrift/kumiko-framework@0.302.0
  - @cosmicdrift/kumiko-bundled-features@0.302.0
  - @cosmicdrift/kumiko-dev-server@0.302.0

## 0.301.0

### Patch Changes

- Updated dependencies [cf629d8]
- Updated dependencies [5028a6c]
- Updated dependencies [bae6958]
  - @cosmicdrift/kumiko-bundled-features@0.301.0
  - @cosmicdrift/kumiko-dev-server@0.301.0
  - @cosmicdrift/kumiko-framework@0.301.0

## 0.300.0

### Patch Changes

- Updated dependencies [2414932]
- Updated dependencies [2414932]
  - @cosmicdrift/kumiko-bundled-features@0.300.0
  - @cosmicdrift/kumiko-framework@0.300.0
  - @cosmicdrift/kumiko-dev-server@0.300.0

## 0.299.0

### Patch Changes

- aa09d45: Fix scaffold boot, guard multi-repo roots, --write-baseline CLI and bunfig overwrite (#3120)

  <!-- kumiko-changes
  feature: dev-server
  type: fix
  title: Scaffolded docker-compose.yml uses the correct Postgres 18 data path; default app mounts auth-foundation so it boots
  migration: |
    No action needed for existing apps; only newly scaffolded apps are affected.
  -->

  <!-- kumiko-changes
  feature: guards
  type: fix
  title: AstGuard.run receives the caller's repo roots (guard-test-timeouts, guard-pii-annotations, guard-section-fields-raw, guard-text-field-stance, guard-i18n-locale-mount, guard-i18n-locale-terminology, check-complexity, guard-direct-fetch, guard-no-direct-fs, guard-write-handler-qns) so multi-repo aggregate runs stop throwing "cannot classify path" or dropping sibling-repo findings; --write-baseline now requires --guard=<name>
  migration: |
    No action needed for AstGuard.run's new optional `roots` parameter. `kumiko-guards guards --write-baseline` no longer writes every ratchet guard's baseline in one call; pass `--guard=<name>` to freeze one guard deliberately, or run it once per guard.
  -->

  <!-- kumiko-changes
  feature: testing
  type: fix
  title: kumiko-testing bunfig merges app-owned sections (e.g. install.scopes) back in and only aborts, naming the key, when a managed [install]/[test] section has a key the template doesn't emit; e2e seed routes gain an isE2eSeedingEnabled() export so a custom server entry can skip mounting them in prod
  migration: |
    If `kumiko-testing bunfig` exits 1 naming a section.key (e.g. test.concurrency), remove or rename that key, or move it out of [install]/[test], then rerun. If your server entry mounts createE2eSeedRoutes() directly instead of using e2e/server.ts, guard the mount with isE2eSeedingEnabled() so prod never registers the seed routes.
  -->

- Updated dependencies [aa09d45]
  - @cosmicdrift/kumiko-dev-server@0.299.0
  - @cosmicdrift/kumiko-framework@0.299.0
  - @cosmicdrift/kumiko-bundled-features@0.299.0

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
