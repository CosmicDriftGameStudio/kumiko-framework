---
status: reference
verified: 2026-09-26
---

# The test standard

Kumiko apps and the framework itself share one test setup, delivered by
`@cosmicdrift/kumiko-testing` and scaffolded by `kumiko new app`. This guide
explains what the standard is and why it looks the way it does, so the old
patterns — `workers: 1` against shared state, a raised timeout, a real test
that fires because a key happens to be in `.env`, a hand-copied screenshot
runner — stop coming back out of habit. For diagnosing a red or flaky test,
see [`test-failures.md`](./test-failures.md); this guide is the model behind
those steps.

## Three classes, never mixed

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

## Real providers: opt-in, never by accident

Tests that call a real external provider (LLM, mail, payment) are named
`*.real.test.ts` (Bun) or `*.real.spec.ts` (Playwright) and start with
`requireRealProviders()` from `@cosmicdrift/kumiko-framework/testing`. Three
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
them: `#3118` measured that oversubscribing workers on a small (1.5-CPU) CI
runner made the e2e run both slower and flakier, not faster — too many
Chromium processes contending for too little CPU. A project that sets its own
`workers` throws.

## Measured effect

#3118's own findings ("Richtwerte, keine Baseline": rough signals, not a
clean measurement) describe the pre-template state: e2e defaulted to
`workers: 1` everywhere; phronexsis's e2e at 2 workers already showed
1.85x, but 4 workers went red from a shared-tenant collision (two flow
specs racing on one tenant), not from a CPU limit, the reason
`seedTenant()` per flow exists.

#3119 collected the actual baseline. Its CI job-minutes table (median of
the last 10 successful runs per app, taken before any port/config change)
is the comparison point ("Laufzeit nicht schlechter als Baseline");
comparing it against the migrated apps' CI minutes is still pending those
migrations. Locally, publicstatus's integration suite (53 files, 370
tests, loaded machine, two runs) measured sequential at 27.0 s / 24.5 s
and `--parallel=4` at 29.3 s / 25.3 s, with 2-4 s of run-to-run noise.

With the template, the same class of suite (56 files, 381 tests, measured
in PR #3294) runs `--parallel=4 --no-isolate` at 27.1 s: within the
baseline's noise band, not worse, with 11 more tests. `--no-isolate` is
required because bun 1.4.0's `--parallel` implies `--isolate`, which leaks
native memory per test file while the JS heap stays flat: the same suite
under bun's `--isolate` default peaks at 3.31 GiB / 49.9 s, OOM-killing
the 3-GiB CI runner, against 1.31 GiB / 27.1 s and 381/381 green under
`--no-isolate` (the runner's default since 0.316.0). That pair is
isolate-vs-no-isolate within the template, not a comparison against the
pre-template baseline. `--no-isolate` is safe here because the template
already isolates through data (`seedTenant` per flow, a queue prefix per
stack), not through OS processes, the same property that makes parallel
e2e safe above.

## Timeouts and retries belong to the template

`defineAppE2eConfig` owns timeouts, retries (always 0) and workers; no
per-test `test.setTimeout`, no per-project override. Centralizing them is
what makes the budget in the table above mean something — a timeout an app
can silently raise is not a budget, it's a suggestion. When a test is
actually slow or flaky, the fix is almost never the timeout: see
[`test-failures.md`](./test-failures.md#diagnosis-order) for the diagnosis
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
constants, never from whatever an app's own config happened to set.

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
a config-level `viewport` or a `deviceScaleFactor` anywhere is flagged unless
it's genuinely not a Playwright-config value (a scenario field) and carries a
`// @template-drift-exception: #<issue> <reason>` marker directly above it.
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
| `test.setTimeout(n)` / a raised project timeout | Diagnose first ([`test-failures.md`](./test-failures.md)); `@timeout-exception` marker only for a genuine no-condition wait |
| A real-provider test that runs whenever an API key is present | `*.real.test.ts` / `*.real.spec.ts` + `requireRealProviders()`, gated by `KUMIKO_REAL_PROVIDERS=1`, hard-stopped in CI |
| A local `page.screenshot()` helper for docs images | `runScreenshots` / `runMatrix` with `SCREENSHOT_DIR` set |
| A shared/global test user across flows | `seedTenant()` per flow |
| A copied `playwright.config.ts` / bunfig from another app | `kumiko-testing bunfig` generator + `defineAppE2eConfig`, updated by a version bump |
| A local `test-setup/dom.preload.ts` copy | `kumiko-testing bunfig --dom`, which preloads `@cosmicdrift/kumiko-testing/preload/dom` |
