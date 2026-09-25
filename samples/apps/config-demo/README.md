# Config Demo

Sample app for the bundled config feature: config keys in all three
scopes (system, tenant, user), seeded values, and the self-populating
settings hub whose edit forms show a source badge per field, so you can
see where a value comes from.

**No auth**: auto-mint JWT mode, straight to the settings screens
without a login. To exercise auth paths, see `samples/apps/admin-console/`
or `samples/apps/ui-walkthrough/`.

## Run

```bash
bun kumiko dev                          # Postgres + Redis
cd samples/apps/config-demo && bun dev
# → http://localhost:4172
```

Port 4172 is the default in `src/app/server.ts` and the `dev` script.
The server reads the root `.env` (`--env-file=../../../.env`).

## What's inside

### Config keys

`src/features/demo/feature.ts` declares five keys with `r.config()`:

| Key | Scope | Type | Default | Write access |
|---|---|---|---|---|
| `siteName` | tenant | text | `My Site` | all |
| `themeColor` | tenant | text | `#000000` | all |
| `maxUploadSize` | tenant | number, bounds 1 to 1000 | `10` | all |
| `emailNotifications` | user | boolean | `true` | all |
| `autoApprove` | system | boolean | `false` | `access.systemAdmin` |

### Seeds

The same feature seeds values with `createTenantSeed` and
`createSystemSeed`: `siteName` "Config Demo", `themeColor` `#6366f1`,
`maxUploadSize` 50 and `autoApprove` true. A tenant seed without
`tenantId` is written as a fallback row that every tenant sees through
the resolver cascade.

### Self-populating settings hub

No `r.screen` or `r.nav` in the feature. Every key with a `mask` shows up
in the settings hub automatically: the config feature generates one
screen per scope (`/config-demo-system`, `/config-demo-tenant`,
`/config-demo-user`) and derives the fields from the key types.
`mask.title` is the i18n key of the field label, `mask.order` its
position.

### Wiring

- `src/app/server.ts` mounts `localeDe`, `config`, `secrets` and the
  demo feature and passes a config resolver plus accessor factory via
  `extraContext`
- `src/app/client.tsx` adds `configClient()` (generic settings labels)
  and `configDemoClient` (the field labels from `src/features/demo/i18n.ts`)
- Labels are translated DE and EN

## Screenshots

```bash
SCREENSHOT_DIR=$(mktemp -d) bun run screenshots   # Playwright on 4173
```

`SCREENSHOT_DIR` is required: without it a normal e2e run skips
`e2e/screenshots.spec.ts`. Two scenarios in `e2e/scenarios.ts`:

- `config-edit`: tenant settings screen in its initial state
- `config-edit-override`: writes tenant values through
  `config:write:set`, then reloads the tenant screen to show the
  override cascade in the source badges

## What's NOT in here

- Auth and roles (see `apps/admin-console/`)
- Business entities (see `apps/marketing-demo/`)
- Every bundled feature at once (see `apps/use-all-bundled/`)
