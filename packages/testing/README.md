# @cosmicdrift/kumiko-testing

Test template for Kumiko apps. Test-only: never import it from production code.

```ts
import { seedTenant, setupAppTestStack } from "@cosmicdrift/kumiko-testing";

const stack = await setupAppTestStack([myFeature]);
const tenant = await seedTenant(stack, { users: 2 }); // light: no rows, own id/key/users
const persisted = await seedTenant(stack, { persist: true }); // real rows via the dispatcher
await tenant.api.writeOk("my-feature:write:thing:create", { title: "x" });
```

- `preload/{temporal,ci-log,scrub-env,env,real}`: bunfig `preload` entries. `scrub-env` removes
  `PROVIDER_ENV_KEYS` (unit default); `env` adds the localhost service defaults (integration);
  `real` refuses to run without `KUMIKO_REAL_PROVIDERS=1` and in CI, and keeps the keys.
- `kumiko-testing bunfig [--dom] [--coverage]`: writes `bunfig.toml`,
  `bunfig.integration.toml` and `bunfig.real.toml` (plus `bunfig.dom.toml`). `--dom` needs your own
  `./test-setup/dom.preload.ts`.
- `kumiko-testing integration [--parallel N] [--timings <file>]`: runs `*.integration.test.ts`
  with the 15s budget. `--parallel` only when you ask for it, and then with `--no-isolate`:
  bun 1.4.0's implicit `--isolate` leaks native memory per file until CI workers are OOM-killed.

## E2E (`./e2e`, `./e2e/seed-route`)

`@playwright/test` is an optional peer dependency; only the `./e2e` subpath imports it. The server side
(`./e2e/seed-route`) never does.

```ts
// e2e/server.ts: mount the seed routes next to the app
runDevApp({ features, auth: { admin }, extraRoutes: createE2eSeedRoutes() });

// playwright.config.ts
export default defineAppE2eConfig({ port: 4321 });

// e2e/flow.spec.ts
import { expect, test } from "@cosmicdrift/kumiko-testing/e2e";
test("member sees the note", async ({ seedTenant, page }) => {
  const tenant = await seedTenant({ users: 1, with: [seedNotes] });
  await tenant.loginAs(page, tenant.members[0]!);
});
```

- `defineAppE2eConfig({ port, env?, locale?, projects?, serverEntry?, testDir?, testMatch? })`: parallelism, retries, timeouts and
  workers (`KUMIKO_E2E_WORKERS` overrides) are fixed by the template; projects cannot set them.
- The seed routes answer only with `KUMIKO_TEST_SEED=1`, outside `NODE_ENV=production`, and with the
  per-run `KUMIKO_TEST_SEED_TOKEN` in the `x-kumiko-test-seed` header. `defineAppE2eConfig` sets all three.
- The template also sets `KUMIKO_DEV_STYLESHEET_WATCH=0`, so the dev-server builds the app's CSS once and
  never starts a Tailwind `--watch` process — that watcher would otherwise treat every Playwright artifact
  write under `test-results/` as a rebuild trigger.
- App roles: `createE2eSeedRoutes({ extraRoles: ["TenantMember"] })` lets `tenant.addUser(["TenantMember"])` seed them.
- `tenant.addUser(["SystemAdmin"])` seeds a platform operator for SysAdmin screens: `SystemAdmin` lands as a
  global user role, and the user joins the tenant as `Member` unless you also pass a tenant role
  (`["TenantAdmin", "SystemAdmin"]`). The seed gate above is the only boundary around this.
- App seeders for test data the seeded users can't create:
  `createE2eSeedRoutes({ extraSeeders: { checks: async (ctx, tenantId, body) => … } })`, called from a flow as
  `await tenant.seed("checks", { days: 30 })`. The seeder gets `body` as `unknown` (validate it with a zod
  `parse`; a `ZodError` becomes a 400) and a `ctx` whose `write`/`query` run as the tenant's system user
  (SystemAdmin), bound to that one tenant, so the target handler must admit SystemAdmin (data no normal
  handler produces, like backdated history, needs a SystemAdmin-only handler). There is no raw DB access.
  Only tenants seeded by the same server's seed-tenant route are accepted; unknown seeder names are a 404.
- A `SeedPart` receives `{ tenant }` and works against the in-process `seedTenant` and the HTTP tenant alike.
- Already have a custom server entry (mail transport, KMS, boot seeds, ...) that also runs in prod?
  Point `serverEntry` at it instead of duplicating `e2e/server.ts`, and mount the seed routes only
  when the seed condition holds: `...(isE2eSeedingEnabled() ? createE2eSeedRoutes() : [])` in its own
  `extraRoutes` — prod then never registers the routes at all, not just a per-request 404.
  `isE2eSeedingEnabled` is exported from `@cosmicdrift/kumiko-testing/e2e/seed-route`.
- App-wide defaults for tests (e.g. a completed onboarding) belong in a `SeedPart` passed to
  `seedTenant({ with: [defaults] })` — never in a `postSave` hook on the `"tenant"` entity, since that
  hook also fires on every real signup in prod.

## Screenshots (`./e2e`)

Seeded identities are unique per run (`admin-<tenantId>@…`). To show a presentable address instead, the
flow registers the mapping once the tenant exists, and the runner replaces it in text and form values
right before every capture (again after each theme and viewport change); the seeded data stays as it is:
`presentIdentities([{ from: tenant.admin.email, to: "anna@example.com" }])` from the scenario fixtures, or
`captureScreenshot(page, name, { presentIdentities: [...] })` inline.

`runScreenshots`/`runMatrix` register their tests on the same `test` as above, so a scenario's `flow`
receives the seeded-tenant fixture too:

```ts
{ name: "dispatch", flow: async (page, { seedTenant }) => {
    const tenant = await seedTenant({ users: 1 });
    await tenant.loginAs(page, tenant.members[0]!);
    await page.goto("/dispatch");
  },
  beforeCapture: async (page) => page.addStyleTag({ content: ".live-clock { visibility: hidden }" }),
}
```

`beforeCapture?: (page) => Promise<void>` runs after the viewport is set and the page has settled,
right before the screenshot. `runMatrix` calls it once per theme × viewport for the same scenario, so
it must be idempotent — hide or mask an element rather than a one-shot action like clicking a button,
which would only succeed on the first capture and time out on every one after.

`runMatrix` also supports real device emulation via Playwright projects named after a viewport id
(`desktop`, `tablet`, `mobile`) with `use.isMobile: true`:

```ts
projects: [
  { name: "desktop", use: { ...devices["Desktop Chrome"] } },
  { name: "tablet", use: { ...devices["iPad Pro 11"] } }, // portrait, WebKit
  { name: "mobile", use: { ...devices["iPhone 13"] } }, // portrait, WebKit
]
```

A device project captures exactly `<name>.png` at the device's native size — no `setViewportSize`,
which would destroy the emulation. Any other project (the desktop pass) still loops the remaining
viewports via `setViewportSize`, skipping the ids a device project already covers. Without device
projects, nothing changes: desktop, tablet and mobile all render through `setViewportSize` as before.
`SCREENSHOT_VIEWPORTS` still filters both — a filtered-out device project's test is skipped, not run
empty. CI needs `bunx playwright install webkit` to run device projects that use a WebKit device.
