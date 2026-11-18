# Kumiko framework: agent instructions

For agents working on this repo. Apps built with Kumiko use
[`packages/framework/AGENTS.md`](packages/framework/AGENTS.md) instead; it ships in the
package, so change it only for app developers and link to it rather than copying it.

Kumiko is a config-driven, event-sourced, multi-tenant app framework on Bun, Hono and
Postgres. A feature registers entities, handlers, events, projections and screens on one
registrar `r`; the framework derives endpoints, tables and UI from them. Most packages publish
TypeScript source, and every breaking change ships a codemod or a migration note.

## Canonical forms

Every registrar verb that takes options takes exactly one options object; positional calls do not
typecheck. `r.crud(entity, options)` and `r.defineEvent(name, schema, { piiFields })` are positional.
An entity carries its name (`createEntity({ name, ... })`), so `r.entity` and `r.crud` take the entity itself.
[`FeatureRegistrar`](packages/types/src/feature-registrar.ts) is the reference.

```ts
const labelEntity = createEntity({ name: "label", fields });
const taskEntity = createEntity({ name: "task", fields });
const feature = defineFeature("tasks", (r) => {
  r.requires({ features: ["files"] });
  r.entity(labelEntity); // entity with hand-written handlers
  r.crud(taskEntity, { write: { access }, read: { access } }); // entity plus CRUD handlers
  const close = r.writeHandler({ name: "task:close", schema, access, handler });
  r.hook({ type: "validation", target: close, handler: validateClose });
  r.applyExtension({ name: "audit-log", entity: "task" });
});
const db = createDbConnection({ url: databaseUrl });
const tenantDb = createTenantDb({ db, tenantId });
const files = createFileProviderS3Feature({ fromEnv: true }); // bundled features are create*Feature()
```

Tests use the real stack over HTTP, never a hand-built dispatcher:
`setupTestStack` from `@cosmicdrift/kumiko-testing/stack`, assertion helpers from
`@cosmicdrift/kumiko-testing/helpers`, then `stack.http.writeOk` and `queryOk`. The
smallest complete example is [`samples/recipes/golden-path`](samples/recipes/golden-path/).

## Packages

| Package | Purpose |
| --- | --- |
| `framework` | Engine, pipeline, API, DB, event store, SSRF-safe egress (`/http`); ships the app-facing `AGENTS.md` |
| `types` | Engine and DB type contracts without the runtime |
| `bundled-features` | Ready-made features: tenant, user, auth, files, billing, jobs, mail and PDF rendering and more |
| `feature-ast` | Feature-file AST (parse, patch, render), pattern library and upgrade codemods |
| `cli`, `dev-server`, `create-kumiko-app` | `kumiko` CLI, dev server and scaffolding, `bun create kumiko-app` |
| `server-runtime` | Production boot: connections, schema-drift gate, lifecycle |
| `testing` | Test stack, seeding, preloads, integration runner |
| `guards` | AST guards and repo checks (`kumiko-guards`), `kumiko.json` schema and loader (`/repo-manifest`) |
| `renderer` | Platform-agnostic renderer plus UI logic, HTTP dispatcher and web bindings (`renderer/headless`, `renderer/live`, `renderer/web`) |
| `document-designer` | Template editor |
| `locale-de`, `locale-es`, `locale-fr`, `locale-it` | Opt-in UI and mail copy |
| `samples` | Packaged source of recipes and sample apps |
| `apps/puppeteer-service` | PDF and image rendering service |
| `samples/recipes/*`, `samples/apps/*` | One tested example per concept, full sample apps |

The full list (17 packages; the five former shims were removed in 0.379.0) is in
[package set](docs/reference/packages.md).

## Commands

| Goal | Command |
| --- | --- |
| Boot validation plus guards, step list only | `bun kumiko check --explain` |
| All guards | `bun packages/guards/src/run-guards.ts` |
| Unit tests | `bun run test` |
| Integration tests (needs `docker compose up -d`) | `bun run test:integration` |
| DOM tests | `bun run test:dom` |
| E2E | no root script; `bunx playwright test --config=<dir>/playwright.config.ts`, suites listed in `.github/workflows/ci.yml` |
| Types | `bun run typecheck` |
| Lint | `bunx biome check <files>` |
| Upgrade an app to the installed version | `bun kumiko-upgrade --apply` |
| Preview a codemod | `bun packages/feature-ast/src/scripts/codemod/<name>.ts <dir> --check` |
| Regenerate agent docs, sample index | `bun run gen:agent-docs`, `bun run gen:sample-index` |

## Hard rules

- Never write to an `r.entity` table or the events table directly. Go through `r.crud`,
  the executor, `emitEvent` or an inline projection.
- `escapeHatch` and `unsafeRaw` need a concrete `reason`; placeholders like "todo" or "legacy" are rejected at boot or at runtime.
- No cross-feature imports of internals. Features talk through events, APIs and extensions.
- Comments are English and explain why, never what.
- Never fix a red test with a timeout, retry, skip or fewer workers; find the cause.
- A new framework feature needs a recipe in `samples/recipes/` or an extension of one.

## Releases

Releases go through changesets: add `.changeset/<name>.md` with a `kumiko-changes` block.
The Version PR is merged by the framework owner (a person, never an agent session) once the work package is green; until
the beta in January 2027 there is no fixed release day, then it becomes a train every two
weeks. A changeset uses `minor` only for a breaking change. If the issue has a release note,
start the `kumiko-changes` block from it and update the issue when the code ends up
different. See [stability policy](docs/reference/stability-policy.md).

## Links

- [Golden path](docs/golden-path.md): entity to tested screen in one recipe
- [App feature structure](docs/reference/app-feature-structure.md)
- [Stability policy](docs/reference/stability-policy.md)
- [Design decisions](docs/reference/decisions.md): read before design or architecture changes; append new lasting decisions at the bottom
- [Package set](docs/reference/packages.md): the 17 packages and where the removed shims went
- [Feature manifest](packages/create-kumiko-app/feature-manifest.json): bundled features, config and dependencies
- [App-facing agent guide](packages/framework/AGENTS.md)
