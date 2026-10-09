---
status: reference
verified: 2026-10-09
---

# The test standard

Kumiko apps and the framework itself share one test setup, delivered by
`@cosmicdrift/kumiko-testing` and scaffolded by `kumiko new app`. This guide
explains what the standard is and why it looks the way it does, so the old
patterns — `workers: 1` against shared state, a raised timeout, a real test
that fires because a key happens to be in `.env`, a hand-copied screenshot
runner — stop coming back out of habit. For diagnosing a red or flaky test,
see [`test-failures.md`](/en/guides/test-failures/); this guide is the model behind
those steps.

## Four classes, never mixed

| Class | Files | Command | Budget |
|---|---|---|---|
| Unit | `*.test.ts` | `bun run test` | 5 s per test |
| Integration | `*.integration.test.ts` | `bun run test:integration` (files run in parallel) | 15 s per test |
| E2E | `e2e/*.spec.ts` | `bun run e2e` | fixed in `defineAppE2eConfig` |
| Real provider | `*.real.test.ts`, `*.real.spec.ts` | `bun run test:real`, `bun run e2e:real` | 240 s per test |

Unit tests carry no services and stay fast enough to run on every save.
Integration tests hit a real Postgres/Redis stack and prove the app's own
wiring. E2E tests boot the app and prove the browser contract. Mixing them —
a unit test that reaches for Postgres, an integration test that spins up a
browser — loses the fast/clear-signal property of the cheaper class and
slows down the whole suite for no extra coverage. `test:dom` (`*.test.tsx`,
happy-dom via `preload/dom`) sits next to unit tests for component-level
rendering that needs a DOM but not a browser.

`kumiko-testing bunfig` generates the bunfig files (preloads, path ignores)
that keep each class in its own lane. Bun ignores a `[test] timeout` key, so
the budget above is a `--timeout` flag in the scripts, from one constant
(`TEST_TIMEOUT_MS`) — not something an app sets per file.

Unit, DOM, integration and real all preload `SCHEMA_ENV_DEFAULTS`
(`JWT_SECRET`, `KUMIKO_SECRETS_MASTER_KEY_V1`,
`KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION`) — the env keys the framework's
own schema (auth, secrets, field-encryption) requires, each filled with `??=`
so an app's own value always wins. Integration and real additionally preload
`SERVICE_ENV_DEFAULTS` (`DATABASE_URL`, `REDIS_URL`, …); unit and DOM don't,
so a unit test that accidentally reaches for a service still fails instead of
silently connecting. An app-specific default (a demo email, a seed value) is
never added to either map — it stays in the app's own preload extra, kept
across regenerations by `kumiko-testing bunfig`.

## Real providers: opt-in, never by accident

Tests that call a real external provider (LLM, mail, payment) are named
`*.real.test.ts` (Bun) or `*.real.spec.ts` (Playwright) and start with
`requireRealProviders()` from `@cosmicdrift/kumiko-framework/testing` (Bun)
or `@cosmicdrift/kumiko-testing/e2e` (Playwright specs and configs, which load
under Node and must not import the framework's `./testing` barrel). Three
reasons they are walled off from the default run:

- **Cost.** A real LLM or payment call has a price; the default suite runs on
  every save and every PR, a real-provider test should not.
- **Non-determinism.** An external provider's output isn't fully under the
  test's control, so it can go red for reasons that have nothing to do with
  the change under test.
- **Secret leaks.** Talking to a real provider means a real credential in the
  process — the default CI run never holds one.

They run only when `KUMIKO_REAL_PROVIDERS=1` is set, through the `test:real` /
`e2e:real` scripts, and never in CI: `requireRealProviders()` throws the
moment `CI` is set, regardless of the flag. A provider API key sitting in the
environment does not enable them on its own — the flag is a separate,
explicit switch.

To run one on purpose: `bun run e2e:real -- <file>` (or `test:real` for Bun
tests). To add one, write the shared flow once and wrap it in a thin
`*.real.spec.ts` that calls `requireRealProviders()`. Neither the wrapper nor
the shared flow sets a timeout: both scripts take the real-provider budget from
one constant, `E2E_TIMEOUT_MS.real` (`test:real` passes it as `--timeout` via
`TEST_TIMEOUT_MS.real`, `defineAppE2eConfig` applies it only when
`KUMIKO_REAL_PROVIDERS=1` is set). It is 240 s because solon's
document-onboarding flow, the slowest real-provider run today, needs that
long; the default suite keeps its own budget.

## Parallel by default

Every flow seeds its own tenant with `seedTenant()` — in-process for
integration tests, over the seed routes the app's `e2e/server.ts` mounts with
`createE2eSeedRoutes()` for e2e (those routes 404 unless
`KUMIKO_TEST_SEED=1`, `NODE_ENV` is not `production`, and the per-run token
matches). A tenant per flow is what makes running everything in parallel
safe: two flows writing to the same tenant, user or row race each other,
`workers: 1` only hides that race by never letting it happen, and the race
comes back the moment two people run the suite differently or a CI runner
gets a second core. Fix the shared state, don't serialize around it.

Seeded data that has to look old (a 90-day uptime strip, a chart with history) is written with `runSeedWritesAt(createdAt, fn)` from `@cosmicdrift/kumiko-framework/event-store`. Every event appended inside `fn` goes through the normal write path (handlers, validation, projections) but is stored with `createdAt` instead of the database `now()`. The function throws `SeedModeDisabledError` before it runs `fn` unless `KUMIKO_TEST_SEED=1` and `NODE_ENV` is not `production`, and the server refuses to boot when the flag is set together with `NODE_ENV=production`. The back-dated time lives in an `AsyncLocalStorage`, so nothing parsed from a request can set it; only in-process code such as an `extraSeeders` entry of `createE2eSeedRoutes` can call it.

```ts illustration
const seedBackdatedNote: E2eExtraSeeder = async (ctx) => {
  const createdAt = Temporal.Now.instant().subtract({ hours: 90 * 24 });
  return runSeedWritesAt(createdAt, async () => ctx.write("notes:write:note:create", { title: "old" }));
};
```

A global-admin view is the one place a tenant per flow doesn't isolate you.
A SystemAdmin overview (show-pony's `platform-overview`, a tenant list, a
platform-wide counter) sees every tenant, including the ones parallel flows are
seeding at that moment. Seed the operator per flow with
`tenant.addUser(["SystemAdmin"])` instead of sharing the tenant seeded at boot,
then assert only on the tenants your own flow seeded (find them by their name
or id), never on global totals, counts or "the first row": those change with
whatever else runs next to the flow. SystemAdmin is seedable because the seed
gate above is the boundary around every seed route; nothing else guards it.

Test data a flow can't create through the UI or the seeded users comes from an
app seeder: `createE2eSeedRoutes({ extraSeeders })` on the server,
`tenant.seed(name, body)` in the flow. It sits behind the same gate, only
reaches tenants that server seeded, and writes through the app's own handlers
as the tenant's system user (SystemAdmin), never into tables directly. The
target handler must admit SystemAdmin; data no normal handler produces
(backdated history, for example) needs a SystemAdmin-only handler for the
seeder to call.

`defineAppE2eConfig` sizes workers off the CPU count rather than maximizing
them: on a small (1.5-CPU) CI runner, 1/2/4 workers measured 2.6/2.6/2.7 min,
so the run is already saturated at one worker and more only adds Chromium
processes. A project that sets its own
`workers` throws.

## Apps with MFA

Against an app that enforces MFA, the e2e `seedTenant` fixture enrolls the
seeded admin itself: when the first login answers with a required MFA setup,
it enrolls a confirmed TOTP factor through the real auth-mfa endpoints.
`seedTenant({ mfa: "totp" })` forces the enrollment when no policy demands it.
The base32 secret comes back as `admin.mfaTotpSecret`, and `loginAs`,
`loginViaApi` and `loginViaUi` answer the MFA challenge with it.
`tenant.addUser(roles, { mfa: "totp" })` enrolls another user the same way and
returns the secret on that user. When an account needs MFA and the credentials
carry no secret, `loginViaApi` throws. This needs `@cosmicdrift/kumiko-testing`
0.345 or later.

## Parallel runs

Framework integration runs as one `bun test --parallel=4 --no-isolate` call
over every `*.integration.test.ts` file, built by the same
`buildIntegrationTestArgs` the CLI uses. The framework's unit step uses the
same flags; DOM steps stay serial. Perf gates run serially.

`--no-isolate` is required: bun's `--parallel` implies `--isolate`, which
leaks native memory per test file and can OOM-kill a small CI runner. It is
safe because the template isolates through data (`seedTenant` per flow, a
queue prefix per stack), not through OS processes. The integration guard
also blocks `mock.module`, the one way files could leak state into each other.

The CI Postgres runs with `fsync=off`, `synchronous_commit=off` and
`full_page_writes=off`: `DROP DATABASE` in `stack.cleanup()` forces a
synchronous checkpoint that queues up under concurrent teardowns.

Result for the framework integration suite: about 460 s serial against 170 to
215 s with `--parallel=4`.

Under `--parallel`, bun's workers ignore `coveragePathIgnorePatterns` and
report more executable lines with zero hits, so unit line coverage reads
lower without any test covering less. `scripts/coverage-badge.ts` filters
all lcov inputs against `bunfig.ci.toml` itself.

## Boot validation in test stacks

`setupTestStack` checks nav, workspace and tree-action references of the mounted
features, the same checks the prod boot runs. A reference into a feature that is
not mounted is skipped, because tests usually mount a subset; a reference into a
mounted feature that does not resolve throws. Screen and ref-entity checks span
features and run only with `setupTestStack({ validateBoot: "full" })`. Every app
should have one boot test that mounts the prod feature composition with
`validateBoot: "full"`, so a broken screen fails in CI instead of at deploy.

## Timeouts and retries belong to the template

`defineAppE2eConfig` owns timeouts, retries (always 0) and workers; no
per-test `test.setTimeout`, no per-project override. Centralizing them is
what makes the budget in the table above mean something — a timeout an app
can silently raise is not a budget, it's a suggestion. When a test is
actually slow or flaky, the fix is almost never the timeout: see
[`test-failures.md`](/en/guides/test-failures/#diagnosis-order) for the diagnosis
order and the `@timeout-exception: #<issue> <reason>` marker for the rare
case that needs one.

## Screenshots: one runner, not a local copy

Doc and preview screenshots go through `runScreenshots`/`runMatrix`
(`@cosmicdrift/kumiko-testing/e2e`), not a hand-written `page.screenshot`
call. `SCREENSHOT_DIR` is mandatory — screenshot specs are skipped entirely
unless it's set, and the runner writes to `$SCREENSHOT_DIR/<name>.png`
(`runScreenshots`) or `$SCREENSHOT_DIR/<name>/<locale>/<theme>/<viewport>.png`
(`runMatrix`) so the images that end up committed into docs are always
produced the same way, from the same viewport and device-scale-factor
constants, never from whatever an app's own config happened to set. `runMatrix`'s desktop
viewport is 1920 wide; set `SCREENSHOT_DESKTOP_WIDTH=1440` for a design review at
another width.

There is no `settleMs`. A fixed sleep before the capture is exactly the
"wait for time, not a condition" anti-pattern the diagnosis order warns
about — it's either too short (captures mid-animation) or too long (slows
every run for a margin nobody measured). The runner instead polls until no
data request is in flight and the page's DOM/scroll-size/animation
fingerprint has been stable for a few consecutive polls, then captures.

## Template instead of copy

`@cosmicdrift/kumiko-testing` is an API — `defineAppE2eConfig`,
`createE2eSeedRoutes`, `seedTenant`, `runScreenshots`/`runMatrix` — not a file
an app copies and edits. A copied `playwright.config.ts` drifts the moment
the template gains a fix (a new timeout constant, a worker-count change,
a screenshot-stability fix): the copy doesn't get it until someone remembers
to re-copy it, and usually nobody does. Calling the API instead means an
improvement ships to every app, including third-party ones, through an
ordinary version bump of `@cosmicdrift/kumiko-testing` — no coordinated
find-and-replace across repos. The `test-template-drift` guard enforces this:
a config-level `viewport` or a `deviceScaleFactor` anywhere is flagged, and a
`// @template-drift-exception: #<issue> <reason>` marker directly above it
suppresses the finding.
A spec's own `test.use({ viewport })` is not flagged — the template defaults
to a 1920px desktop viewport, and a spec asserting a layout that only exists
below that width (a mobile breakpoint, a narrow-container overflow case) sets
its own viewport, same as it always could. `deviceScaleFactor` has no such
per-spec case, so it stays template-owned everywhere.

## Coming from the old setup

| Old pattern | New pattern |
|---|---|
| `workers: 1` / `fullyParallel: false` in `playwright.config.ts` | `defineAppE2eConfig({ port, serverEntry, ... })` — parallel by default, tenant per flow |
| Hand-rolled `defineConfig` with a custom viewport/DPR | `defineAppE2eConfig` (viewport/DPR are template-owned) |
| `test.setTimeout(n)` / a raised project timeout | Diagnose first ([`test-failures.md`](/en/guides/test-failures/)); `@timeout-exception` marker only for a genuine no-condition wait |
| A real-provider test that runs whenever an API key is present | `*.real.test.ts` / `*.real.spec.ts` + `requireRealProviders()`, gated by `KUMIKO_REAL_PROVIDERS=1`, hard-stopped in CI |
| A local `page.screenshot()` helper for docs images | `runScreenshots` / `runMatrix` with `SCREENSHOT_DIR` set |
| A shared/global test user across flows | `seedTenant()` per flow |
| A copied `playwright.config.ts` / bunfig from another app | `kumiko-testing bunfig` generator + `defineAppE2eConfig`, updated by a version bump |
| A local `test-setup/dom.preload.ts` copy | `kumiko-testing bunfig --dom`, which preloads `@cosmicdrift/kumiko-testing/preload/dom` |
| An app-local preload setting `JWT_SECRET` / `KUMIKO_SECRETS_MASTER_KEY_*` | `SCHEMA_ENV_DEFAULTS`, preloaded automatically in every `kumiko-testing bunfig` variant |
