# Samples

Tested examples for framework features. Two buckets:

- **`recipes/`** — one concept = one feature definition + one test. If a
  framework change breaks something, the recipe test goes red. Server-only,
  no UI.
- **`apps/`** — full-stack demos with dev-server + browser client. Show the
  UI layer + auth wiring + WorkspaceShell.

For full app-domain showcases (multiple features per app, deployed),
see [publicstatus](https://github.com/cosmicdriftgamestudio/publicstatus) —
an open-source statuspage clone built with Kumiko.

## Recipes — I want to do X → sample

| I want to... | Sample | Test type |
|--------------|--------|-----------|
| Entity + standard handlers + soft delete + optimistic locking | [recipes/basic-entity](recipes/basic-entity/) | Integration |
| Custom handlers with business logic | [recipes/custom-handlers](recipes/custom-handlers/) | Integration |
| Parent-child relations + cascade/restrict | [recipes/relations](recipes/relations/) | Integration |
| Embedded objects (1:1 sub-shapes inside a parent row) | [recipes/embedded](recipes/embedded/) | Integration |
| Hide/protect fields per role | [recipes/field-access](recipes/field-access/) | Integration |
| Hooks (validation, preSave, postSave) | [recipes/lifecycle-hooks](recipes/lifecycle-hooks/) | Integration |
| Seed reference data (`r.referenceData`) | [recipes/reference-data](recipes/reference-data/) | Integration |
| Full-text search (searchable, searchWeight) | [recipes/search](recipes/search/) | Integration |
| Realtime updates via SSE | [recipes/realtime-sse](recipes/realtime-sse/) | Integration |
| Cross-feature reactions (`ctx.appendEvent` + `r.multiStreamProjection`) | [recipes/cross-feature-events](recipes/cross-feature-events/) | Integration |
| Full event sourcing (defineEvent + Upcaster + Projections + asOf + archive) | [recipes/event-sourcing](recipes/event-sourcing/) | Integration |
| State machine (allowed transitions enforced) | [recipes/state-machine](recipes/state-machine/) | Integration |
| Request deduplication (idempotency) | [recipes/idempotency](recipes/idempotency/) | Integration |
| Multi-tenant data isolation | [recipes/tenant-isolation](recipes/tenant-isolation/) | Integration |
| Anonymous access (public endpoints, no auth) | [recipes/anonymous-access](recipes/anonymous-access/) | Integration |
| Anonymous access in multi-tenant setup | [recipes/anonymous-access-multitenant](recipes/anonymous-access-multitenant/) | Integration |
| Internationalization (i18n) | [recipes/i18n](recipes/i18n/) | Unit |
| Clean error handling (Kumiko error classes, reasons, helpers) | [recipes/error-contract](recipes/error-contract/) | Integration |
| Default-deny access rules + FK indices via relations | [recipes/access-control](recipes/access-control/) | Integration |
| Features inject identity facts into the JWT (`r.authClaims`) | [recipes/auth-claims](recipes/auth-claims/) | Integration |
| Row-level ownership (entity + field, read + write, straddle-safe) | [recipes/ownership](recipes/ownership/) | Integration |
| Pin jobs to deploy lane (`runIn: "api" \| "worker"`), event-triggered fan-out | [recipes/lane-routing](recipes/lane-routing/) | Integration |
| Register screens + navigation (`r.screen` + `r.nav`) with cross-feature parents | [recipes/screens-nav](recipes/screens-nav/) | Unit |
| Generate Playwright E2E specs from the registry | [recipes/e2e-generator](recipes/e2e-generator/) | Unit |
| Multi-currency money type (global rate table) | [recipes/currencies-global](recipes/currencies-global/) | Integration |
| Multi-currency money type (per-tenant rate table) | [recipes/currencies-per-tenant](recipes/currencies-per-tenant/) | Integration |
| Email/SMS/in-app delivery notifications | [recipes/delivery-notifications](recipes/delivery-notifications/) | Integration |
| Encrypted tenant config (per-tenant secrets at rest) | [recipes/encrypted-tenant-config](recipes/encrypted-tenant-config/) | Integration |
| Feature toggles (per-tenant on/off) | [recipes/feature-toggles](recipes/feature-toggles/) | Integration |
| File upload + post-processing (resize, virus scan, etc.) | [recipes/files-post-processing](recipes/files-post-processing/) | Integration |
| Legal pages (terms, privacy, imprint) with versioned acceptance | [recipes/legal-pages](recipes/legal-pages/) | Integration |
| Rate limiting per user / IP / endpoint | [recipes/rate-limiting](recipes/rate-limiting/) | Integration |
| Secrets management (env-var → encrypted DB row) | [recipes/secrets-demo](recipes/secrets-demo/) | Integration |
| Session revocation (logout-all, force-logout, audit) | [recipes/session-revocation](recipes/session-revocation/) | Integration |
| Designer-driven feature (live schema edits via UI) | [recipes/designer-demo](recipes/designer-demo/) | — |

## Apps — UI + dev-server

| Sample | What it shows |
|--------|---------------|
| [apps/ui-walkthrough](apps/ui-walkthrough/) | DefaultAppShell + LanguageSwitcher + ThemeToggle + emailPasswordClient + TenantSwitcher + tasks demo. Includes Playwright E2E. |
| [apps/workspaces](apps/workspaces/) | WorkspaceShell + persona/role-gated workspaces + cross-feature nav members + server-injected AppSchema. |
| [apps/marketing-demo](apps/marketing-demo/) | Asset tracker + helpdesk on one Kumiko instance — internal-tools showcase with translated select options, deterministically seeded. |
| [apps/showcase](apps/showcase/) | Generic showcase app to exercise the full feature surface in one place. |
| [apps/cap-billing-demo](apps/cap-billing-demo/) | Billing-foundation + cap engine + Stripe + Mollie integration on one app. |

## Running tests

```bash
yarn kumiko test              # Unit tests (incl. recipes/i18n + recipes/screens-nav)
yarn kumiko test integration  # Integration tests (all recipes with DB)
yarn kumiko test e2e          # Playwright E2Es (apps/)
yarn kumiko test all          # Unit + Integration
```

## Production build

`yarn build` in any app workspace produces deployable artifacts. Requires
`"scripts": { "build": "kumiko-build" }` in the `package.json`. Convention-
driven discovery — `kumiko-build` builds whatever is present:

| Convention | Output | Contents |
|-----------|--------|----------|
| `src/client.tsx`, `public/`, `index.html`, `src/styles.css` | `dist/` | Client bundle: hashed assets, Tailwind, static files |
| `bin/main.ts` | `dist-server/` | Server bundle: `server.js` + `kumiko.js` + `migration-hooks.js` (optional) + minimal `package.json` with native externals |

Workspaces without `bin/main.ts` get only the client; headless apps without
a browser get only the server. Both are built in parallel when present.

**Server bundle:** bundles framework + bundled-features + app source into a
~1 MB JS file. Seven native externals (argon2, bullmq, drizzle-kit,
drizzle-orm, ioredis, postgres, temporal-polyfill) stay as prod-deps in a
generated `dist-server/package.json`. Version-pin from the repo's
`packages/framework/package.json`. For app-specific externals, see
`buildServerBundle({ extraRuntimeExternals })` in
`@cosmicdrift/kumiko-dev-server/build`.

**Container deploy:** the [publicstatus deploy folder](https://github.com/cosmicdriftgamestudio/publicstatus/tree/main/deploy)
is the reference — multi-stage Dockerfile builds both bundles, runtime
image only knows `dist/`, `dist-server/`, `drizzle/`. The
`dist-server/package.json` is filled in the runtime stage via
`bun install --production` (~30 MB node_modules + 100 MB bun-alpine base
≈ 270 MB image). Migrate step in pre-deploy: `bun /app/kumiko.js migrate
apply` runs the bundled kumiko CLI against the DB.

## Creating a new recipe

```
samples/recipes/my-recipe/
  package.json              ← { "name": "@cosmicdrift/kumiko-sample-my-recipe", "dependencies": { "@cosmicdrift/kumiko-framework": "workspace:*" } }
  src/
    feature.ts              ← defineFeature + entity + handler
    __tests__/
      feature.integration.ts ← test (or .test.ts for unit tests)
```

Rule: every new framework feature needs a recipe — or an extension to an
existing one.
