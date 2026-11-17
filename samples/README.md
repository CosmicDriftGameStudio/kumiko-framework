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

## Recipes

[`packages/framework/agents/examples.md`](../packages/framework/agents/examples.md) lists every
recipe with the `description` from its `package.json`. `bun run gen:agent-docs` generates it,
so a new recipe shows up there without a hand-written entry. The smallest complete example is
[`recipes/golden-path`](recipes/golden-path/).

## Apps — UI + dev-server

| Sample                                                    | What it shows                                                                                                                                                      |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [apps/admin-console](apps/admin-console/)                 | Bundled admin shell: tenant and platform workspaces with screens from the owning features.                                                                         |
| [apps/cap-billing-demo](apps/cap-billing-demo/)           | Billing-foundation + cap engine + Stripe + Mollie integration on one app.                                                                                          |
| [apps/config-demo](apps/config-demo/)                     | Config seeding and the config source badge in the config edit form.                                                                                                |
| [apps/marketing-demo](apps/marketing-demo/)               | Asset tracker + ticketing on one Kumiko instance — internal-tools showcase with translated select options, deterministically seeded.                               |
| [apps/showcase](apps/showcase/)                           | Generic showcase app to exercise the full feature surface in one place.                                                                                            |
| [apps/styleguide](apps/styleguide/)                       | Gallery of the auto-UI building blocks; its screenshot runner shoots them in three themes for the docs.                                                            |
| [apps/ui-walkthrough](apps/ui-walkthrough/)               | DefaultAppShell + LanguageSwitcher + ThemeToggle + emailPasswordClient + TenantSwitcher + tasks demo. Includes Playwright E2E.                                     |
| [apps/use-all-bundled](apps/use-all-bundled/)             | Mounts every bundled feature, so framework CI catches coverage gaps that real apps miss.                                                                           |
| [apps/user-data-rights-demo](apps/user-data-rights-demo/) | DSGVO Art. 15+17+18+20 end-to-end: todos-Domain mit `EXT_USER_DATA`-Hooks, request-export → ZIP-Bundle, request-deletion → Forget-Cleanup, Restriction-Auth-Block. |
| [apps/workspaces](apps/workspaces/)                       | WorkspaceShell + persona/role-gated workspaces + cross-feature nav members + server-injected AppSchema.                                                            |

## Running tests

```bash
bun kumiko test              # Unit tests (incl. recipes/i18n + recipes/screens-nav)
bun kumiko test integration  # Integration tests (all recipes with DB)
bun kumiko test e2e          # Playwright E2Es (apps/)
bun kumiko test all          # Unit + Integration
```

## Production build

`bun run build` in any app workspace produces deployable artifacts. Requires
`"scripts": { "build": "kumiko-build" }` in the `package.json`. Convention-
driven discovery — `kumiko-build` builds whatever is present:

| Convention                                                  | Output         | Contents                                                                                                                  |
| ----------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `src/client.tsx`, `public/`, `index.html`, `src/styles.css` | `dist/`        | Client bundle: hashed assets, Tailwind, static files                                                                      |
| `bin/main.ts`                                               | `dist-server/` | Server bundle: `server.js` + `kumiko.js` + `migration-hooks.js` (optional) + minimal `package.json` with native externals |

Workspaces without `bin/main.ts` get only the client; headless apps without
a browser get only the server. Both are built in parallel when present.

**Server bundle:** bundles framework + bundled-features + app source into a
~1 MB JS file. Native externals (argon2, bullmq, postgres, ioredis,
temporal-polyfill) stay as prod-deps in a
generated `dist-server/package.json`. Version-pin from the repo's
`packages/framework/package.json` (and the app's own deps for extras).

App-specific native deps (e.g. `@napi-rs/canvas`): declare them in the app
`package.json` and list them for `kumiko-build`:

```json
{
  "kumiko": {
    "extraRuntimeExternals": ["@napi-rs/canvas"]
  }
}
```

Or call `buildServerBundle({ extraRuntimeExternals })` from
`@cosmicdrift/kumiko-dev-server/build` directly.

**Container deploy:** the [publicstatus deploy folder](https://github.com/cosmicdriftgamestudio/publicstatus/tree/main/deploy)
is the reference — multi-stage Dockerfile builds both bundles, runtime
image only knows `dist/`, `dist-server/`, migration SQL dirs (`drizzle/`
legacy or `kumiko/migrations/`). The
`dist-server/package.json` and the `dist-server/bun.lock` written by `kumiko-build`
are installed in the runtime stage via
`bun install --production --frozen-lockfile` (~30 MB node_modules + 100 MB bun-alpine base
≈ 270 MB image). Migrate step in pre-deploy: `bun /app/kumiko.js migrate
apply` runs the bundled kumiko CLI against the DB.

## Creating a new recipe

```
samples/recipes/my-recipe/
  package.json              ← { "name": "@cosmicdrift/kumiko-sample-my-recipe", "description": "<one sentence>", "dependencies": { "@cosmicdrift/kumiko-framework": "workspace:*" } }
  src/
    feature.ts              ← defineFeature + entity + handler
    __tests__/
      feature.integration.test.ts ← test (or .test.ts for unit tests)
```

Rule: every new framework feature needs a recipe — or an extension to an
existing one.
