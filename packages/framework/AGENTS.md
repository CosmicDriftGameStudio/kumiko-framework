# Kumiko for coding agents

This file ships inside `@cosmicdrift/kumiko-framework`. It always matches the
installed version. Read it before you add or change a feature in a Kumiko app.

Next to it, under `agents/`, are generated files. They are rebuilt from the
framework source on every release, so they never describe an API that does
not exist in your version:

| File | What it holds |
| --- | --- |
| `agents/features.md` | Every bundled feature: name, purpose, config keys, dependencies |
| `agents/widgets.md` | Every value export of `@cosmicdrift/kumiko-renderer/web` with its short description |
| `agents/examples.md` | Index of the worked examples, one per concept |
| `agents/examples/<name>.md` | One tested sample app: README plus every source and test file |

The paths are relative to this file. From an app root they live under
`node_modules/@cosmicdrift/kumiko-framework/`. Type signatures are in
`dist/*.d.ts` of each package; this file does not repeat them.

Order of work for a new feature:

1. Search `agents/features.md` for a bundled feature that already does it.
2. Find the closest example in `agents/examples.md` and read it fully.
3. Build the feature with the declarative building blocks below.
4. Write an integration test against the real stack.
5. Run boot validation and the tests. Boot errors name the fix; apply it.

## Mental model

A Kumiko app is a list of features. Everything a feature does is registered
on the `r` registrar inside `defineFeature(name, (r) => { ... })`. There is no
router, controller or ORM to wire by hand. The framework reads the
registrations, validates them at boot, and builds HTTP endpoints, database
tables, events, screens and navigation from them.

**Feature.** A named unit (`defineFeature("tasks", ...)`). It owns entities,
handlers, screens, navs, translations, config and events. Features talk to
each other through events, declared APIs and extensions, never through
imports of each other's internals. An app mounts features in
`src/run-config.ts` (`APP_FEATURES`).

**Entity.** A typed record built with `createEntity({ fields })` and field
factories such as `createTextField`, `createNumberField`,
`createBooleanField`. An entity is event sourced: every write appends an
event, and the table you query is a projection of those events. You never
write the table yourself.

**Handler.** The only way in. A write handler changes state, a query handler
reads it. Both have a qualified name (QN), a Zod payload schema and an access
rule. `r.crud(name, entity, options)` registers the entity plus create,
update, delete, restore, list and detail handlers in one call. Its options
need an access rule for both sides, `write: { access }` and
`read: { access }`; `verbAccess: { delete: { roles: ["Admin"] } }`
overrides a single verb. Without them boot stops. Turn single
verbs off with `verbs: { delete: false }` and register them yourself when
they need different access or logic. Custom logic goes into
`r.writeHandler({ name, schema, handler, access })` and
`r.queryHandler({ name, schema, handler, access })`; inside, use the entity
executor from `createEntityExecutor(name, entity)`. Its `detail` and `list`
return rows typed from the entity (`EntityRow<typeof entity>`), so
`row.title` needs no cast; money and located-timestamp fields come back as
objects, and `create` / `update` payloads stay untyped.

**Screen.** A declarative page: `r.screen({ id, type, ... })`. Types include
`entityList`, `entityEdit`, `projectionList`, `projectionDetail`,
`actionForm`, `dashboard` and `custom`. The renderer builds the UI from the
declaration. Columns, sections, row actions, tabs, wizard steps and
conditional fields are data, not JSX. A `dashboard` lists `panels`; a
`stat` panel names a query handler and the `valueField` to show from its
result, and a `stat-group` panel holds several stats. The query returns one
flat object with those fields.

**Nav.** A sidebar entry: `r.nav({ id, label, screen, parent, order })`.
Parents may belong to another feature; refer to them by QN.

**Events.** Declare a domain event with `r.defineEvent(name, zodSchema)`.
Emit it inside a write handler with `emitEvent(ctx, def, { ... })` or
`ctx.appendEvent(...)`; it commits in the same transaction as the write.
React to it with `r.projection(...)` (state on the same stream) or
`r.multiStreamProjection({ name, apply })` (async consumer across streams,
at least once, ordered).

**Tenant scoping.** Every request runs for one tenant. `ctx.db`, executors
and queries are already filtered to that tenant. You do not pass a
`tenantId` around and you do not add tenant filters yourself. A feature
that holds global data calls `r.systemScope()`.

**Access.** Default deny. Every handler states who may call it:
`{ access: { roles: ["Admin", "User"] } }`, or
`{ access: { openToAll: { reason: "<why every signed-in user may>" } } }`.
Screens and nav entries can narrow visibility further with their own
`access`. Anonymous endpoints use the `anonymous` role. Field level and row
level rules exist as well (see the table below).
An `openToAll` write handler whose payload contains personal fields must
say that every tenant member may write them:
`{ openToAll: { reason: "...", personalData: "tenant-members" } }`. The
alternatives are roles, or binding each row to its caller. Boot names all
three. On query handlers `personalData` is only valid as
`access: { roles: ["anonymous"], personalData: "public-intake" }`.

**Personal data.** Every text field says whether it holds personal data;
the field types reject a text field without that stance.
`personal: false, reason: "is_business_data"` (a snake_case reason) for
business data. For personal data name the subject, `personal: "self"`,
`personal: { of: "<ownerField>" }` or `personal: "tenant"`, plus
`find: "exact" | "fuzzy" | "none" | "secret"`. A plain foreign key to a user
is `personal: "ref"`. `personal: "self"` is for the row that is the user.
When the record itself is the person, such as a contact or a customer that
is not a user, use `personal: { of: "id" }`; the entity then needs a uuid
`id`. The framework encrypts personal fields per subject and
can erase them on request.

**Client.** The web side of a feature is a `ClientFeatureDefinition` in the
feature's `web/index.ts` (name, translations, custom screen components). It
is mounted in `src/client.tsx`. Declarative screens need no client code.

## Qualified names

Names are built from the feature name, a kind and an id. Use the QN wherever
another feature or a test refers to something.

| Thing | Pattern | Example from the scaffolded demo feature |
| --- | --- | --- |
| Write handler | `<feature>:write:<entity>:<verb>` | `tasks:write:task:create` |
| Query handler | `<feature>:query:<entity>:<verb>` | `tasks:query:task:list` |
| Screen | `<feature>:screen:<id>` | `tasks:screen:task-list` |
| Nav entry | `<feature>:nav:<id>` | `tasks:nav:tasks` |
| Translation key | `<feature>:<path>` | `tasks:nav.tasks` |
| Entity field label | `<feature>:entity:<entity>:field:<field>` | `tasks:entity:task:field:title` |

Inside one feature, a screen id without prefix (`screen: "task-edit"`) refers
to a screen of the same feature.

## Where things live in an app

The scaffold (`bun create kumiko-app <name>`) produces this layout. Keep it.

| Path | Content |
| --- | --- |
| `kumiko.config.ts` | `defineAppConfig({ features, prodFeatures?, client, ports })`: the one list the tooling reads |
| `src/run-config.ts` | `APP_FEATURES`, the mounted feature list |
| `src/features/<name>/feature.ts` | `defineFeature(...)` with entities, handlers, screens, navs |
| `src/features/<name>/index.ts` | Public exports of the feature |
| `src/features/<name>/web/index.ts` | Client feature definition |
| `src/client.tsx` | Web entry, mounts the client features |
| `src/__tests__/*.test.ts` | Unit tests, no services |
| `src/__tests__/*.integration.test.ts` | Integration tests against Postgres and Redis |
| `e2e/*.spec.ts` | Playwright tests against a booted app |
| `kumiko/schema.ts`, `kumiko/migrations/` | Generated schema shim over `kumiko.config.ts`, and the migrations |
| `bin/server.ts`, `bin/main.ts`, `bin/env-schema.ts` | Dev server, production boot, env contract |
| `e2e/_helpers/`, `src/__tests__/_setup.ts` | Shared e2e helpers and the shared integration stack setup |

Files whose first line reads `kumiko-managed` (deploy/, `.github/workflows/`,
`.husky/pre-push`, the bunfigs, `kumiko/schema.ts`) belong to the framework.
`bun run check` reports drift against the installed version and
`bunx kumiko sync-managed --write` restores them. Keep a deliberate change with
`# kumiko-managed: local <reason>` on line 2. `biome.json` and `tsconfig.json`
extend `@cosmicdrift/kumiko-framework/biome` and `.../tsconfig.app.json`; put
app overrides next to `extends`. Full list: `docs/reference/app-skeleton.md`.

The scaffolded `src/features/tasks/feature.ts` and
`src/__tests__/tasks.integration.test.ts` are the smallest complete pair of
feature and test. Start from them.

## Commands in an app

| Goal | Command |
| --- | --- |
| Run the app with demo data | `bun dev` |
| Boot validation without serving | `bun run boot` |
| Boot, guards, managed files and script standard | `bun run check` |
| Restore framework-owned files | `bunx kumiko sync-managed --write` |
| Types | `bun run typecheck` |
| Lint | `bun run lint` |
| Unit tests | `bun run test` |
| Integration tests (needs `docker compose up -d`) | `bun run test:integration` |
| Browser tests | `bun run e2e` |
| New migration after an entity change or a newly mounted bundled feature | `bun run schema:generate <name>` |
| Check migrations against the features, no database needed | `bun kumiko-schema validate` |
| Apply migrations | `bun run schema:apply` |

`<name>` is required and becomes part of the file name
(`schema:generate add-invoice`). Mounting a bundled feature in
`APP_FEATURES` adds its tables, so it needs a migration like your own
entities do.

## Rules: never this, do that

These rules are enforced by boot validation, guards or review. Breaking them
produces code that compiles and then fails in production.

### Data and events

- Never `INSERT`, `UPDATE` or `DELETE` on an entity table or the events
  table, and never call a raw database client for it. Write through a
  handler: `r.crud`, the `defineEntity*Handler` helpers, the executor from
  `createEntityExecutor`, or `emitEvent` / `ctx.appendEvent`. The query
  helpers and `ctx.db` throw `AccessDeniedError` on such a write, also
  through `ctx.db.unsafeRaw()`. Test seeds use `seedRow` / `deleteRows` from
  `@cosmicdrift/kumiko-testing`.
- Never store a value that can be computed. Derive it in a query or a
  projection.
- Never hand-write SQL for reads that an executor `list` or `detail` covers.
  Use `r.queryHandler` with the executor, or a projection with
  `ctx.queryProjection`.
- Never pass a JS array as a parameter to `.unsafe(sql, [...])`. Bun.SQL
  binds it as `"a,b"` on Linux (CI) and passes on macOS, so `ANY($n)` only
  fails in CI. Pass `toPostgresArrayLiteral(values)` from
  `@cosmicdrift/kumiko-framework/db` and cast the placeholder (`$1::text[]`);
  the Unsafe Array Param guard warns about array literals.
- Never filter or count the rows of one `list` page in code. `list` returns
  one page (default 50, `limit` at most 200). Pass
  `filter: { field, op, value }` (`eq`, `ne`, `lt`, `gt`, `lte`, `gte`, `in`)
  so the database filters, and `totalCount: true` to get `total` over all
  matching rows; `limit: 1, totalCount: true` is a count query. Groups and
  sums are the same: pass `aggregate: { groupBy?, measures: [{ field, kind }] }`
  (`kind` is `sum`, `avg`, `count`, `min` or `max`) and the list answers with
  `{ groups: [{ key, label?, count, measures }] }` over the same filters,
  search and ownership, at most 200 groups (`truncated: true` beyond that).
  A money measure answers per currency, `[{ currency, value }]` with `value`
  in minor units, never one sum across currencies. `bigInt` measures come
  back as JS numbers and are exact only up to 2^53.
  Custom handlers call `executor.aggregate(...)` or `answerListAggregate`.
- Never change an event schema in place once it has been emitted. Version it
  (see `agents/examples/event-sourcing.md`).
- Never read or write another tenant's data. `ctx.db` is tenant scoped on
  purpose. Cross-tenant work belongs in system features with explicit
  system access.

### Handlers and access

- Never register a handler without `access`. Use roles, or `openToAll` with
  a concrete `reason`.
- Never throw plain `Error` for an expected domain failure. Return a typed
  failure from `@cosmicdrift/kumiko-framework/errors` (for example
  `failNotFound(entity, id)`); it reaches the client as a structured error
  with a reason and, where documented, a `docsUrl`.
- Never parse request input by hand. The Zod schema of the handler is the
  boundary; inside the handler the payload is typed.
- Read-modify-write updates pass the `version` they read, so concurrent
  writes fail with `version_conflict` instead of overwriting each other.

### Types

- Never use `any`. Validate external data once at the boundary (Zod), then
  work with the inferred type.
- Never use `as` to force a type except at a real system boundary. Narrow
  unions with a discriminant and `unknown` with a type guard.
- Never write a magic string where a union type or a QN exists.

### UI

- Never write your own JSX for a list, form, detail page or dashboard.
  Declare a screen. Use `type: "custom"` only when no screen type fits.
- Inside a custom screen, never build your own card, table, badge, button or
  chart. Use the widgets from `@cosmicdrift/kumiko-renderer/web`
  (`agents/widgets.md`) and the primitives from `usePrimitives()`.
- Never fetch data with `useEffect` plus `fetch`. Use `useQuery`
  (`live: true` for server-sent updates) and `useMutation`.
- Never use inline styles, hex colors or Tailwind palette classes. Use the
  theme tokens (`bg-primary`, `text-status-ok`, ...).
- Never put user-facing text in code. Use translation keys and `t("...")`;
  register the texts with `r.translations` and the client translations.

### Tests

- Integration tests run against the real stack over real HTTP. In an app:
  `setupAppTestStack([feature])` plus `seedTenant(stack)` from
  `@cosmicdrift/kumiko-testing`, then `tenant.api.writeOk` and
  `tenant.api.queryOk`. Never assemble a dispatcher yourself
  (`createTestDispatcher` or similar); it skips the production wiring.
- Every test seeds its own tenant. No shared tenant, no global fixtures.
- Assert behavior through handlers and their results, not internal tables.
- A red or flaky test gets diagnosed. Never fix it with a longer timeout, a
  retry, `serial` or fewer workers.
- Tests that call real external providers end in `.real.test.ts` and run
  only via `bun run test:real`, never in CI.

### Boot errors

- Boot validation stops the app when a declaration is inconsistent: an
  unknown field in a column, a nav pointing at a missing screen, an
  encrypted field marked searchable. The message names the
  feature, the place and the fix. Apply the fix the message names instead
  of working around the check.

## I need X, use Y

Before building anything here, search `agents/features.md`: auth, tenants,
mail, files, jobs, billing, audit, notifications and GDPR flows already exist
as bundled features.

| I need | Use | Read |
| --- | --- | --- |
| A CRUD entity with list and edit | `createEntity` + `r.crud` + `entityList` / `entityEdit` screens | `agents/examples/basic-entity.md` |
| Business logic beyond CRUD | `r.writeHandler` / `r.queryHandler` with `createEntityExecutor` | `agents/examples/custom-handlers.md` |
| Filtered lists and counts | Executor `list` with `filter` and `totalCount` | `agents/examples/custom-handlers.md` |
| Key figures on a dashboard | `dashboard` screen with `stat` / `stat-group` panels and a query handler | `agents/examples/dashboard-stats.md` |
| Relations between entities | `r.relation(entity, name, { type, target, foreignKey, onDelete })` | `agents/examples/relations.md` |
| Structured sub-objects in a field | Embedded fields | `agents/examples/embedded.md` |
| List, edit, custom screens and navs | `r.screen`, `r.nav` | `agents/examples/screens-nav.md` |
| A record page with header, metrics, tabs | `projectionDetail` with `header`, `metrics`, `layout.mode: "tabs"` | `agents/examples/record-detail-layout.md` |
| A multi-step form | `layout.mode: "wizard"` | `agents/examples/wizard-form.md` |
| A form inside a drawer | `RenderEdit` in a `Drawer` | `agents/examples/embedded-entity-form.md` |
| Role-based access | `access: { roles }`, `openToAll` | `agents/examples/access-control.md` |
| Field-level access | Field access rules | `agents/examples/field-access.md` |
| Row ownership | Ownership rules | `agents/examples/ownership.md` |
| Tenant separation | Built in; see what it guarantees | `agents/examples/tenant-isolation.md` |
| Public or anonymous endpoints | `anonymous` role | `agents/examples/anonymous-access.md` |
| Allowed state changes | Entity transitions | `agents/examples/state-machine.md` |
| React to a write in another feature | `r.defineEvent` + `emitEvent` + `r.multiStreamProjection` | `agents/examples/cross-feature-events.md` |
| Projections, event versions, history | `r.projection`, `ctx.loadAggregate`, `ctx.queryProjection` | `agents/examples/event-sourcing.md` |
| Before or after save logic | Lifecycle hooks | `agents/examples/lifecycle-hooks.md` |
| Typed errors with reasons | `@cosmicdrift/kumiko-framework/errors` | `agents/examples/error-contract.md` |
| Translations | `r.translations` + client translations | `agents/examples/i18n.md` |
| Config per tenant or system | Managed config | `agents/examples/managed-config.md` |
| Tenant defaults (currency, locale) | Tenant settings | `agents/examples/tenant-settings.md` |
| Secrets such as API keys | Secrets with envelope encryption | `agents/examples/secrets-demo.md` |
| Personal data and erasure | `personal` / `find` annotations, crypto shredding | `agents/examples/crypto-shredding-hr.md` |
| GDPR export and forget for my data | `user-data-rights` extension | `agents/examples/user-data-rights.md` |
| Full-text search | Search feature | `agents/examples/search.md` |
| Live updates in the browser | Server-sent events, `useQuery({ live: true })` | `agents/examples/realtime-sse.md` |
| Feature toggles | Toggleable features | `agents/examples/feature-toggles.md` |
| Rate limits | Rate limiting | `agents/examples/rate-limiting.md` |
| Idempotent writes | Request id dedupe | `agents/examples/idempotency.md` |
| File variants and images | File fields, derivatives | `agents/examples/files-post-processing.md` |
| Money fields | Currency fields | `agents/examples/currencies-per-tenant.md` |
| Dates, times, time zones | Time-aware field types, `ctx.tz` | `agents/examples/timezones.md` |
| Tags or notes on any entity | Tags, notes history | `agents/examples/tags-basic.md`, `agents/examples/notes-history-basic.md` |
| Tenant-defined extra fields | Custom fields | `agents/examples/custom-fields-basic.md` |
| Lookup tables and seeds | Upsert seeds | `agents/examples/reference-data.md` |
| Multi-step background flows | Workflow engine | `agents/examples/workflow-engine.md` |
| A mount invariant for my feature | `r.bootCheck` | `agents/examples/boot-check.md` |
| A widget for a custom screen | Search by concern | `agents/widgets.md` |
| A bundled feature and its config | Search by name or purpose | `agents/features.md` |

## Reading an example

Each `agents/examples/<name>.md` starts with the sample's README, then every
source file with its path. `src/feature.ts` holds the feature;
`src/__tests__/*.integration.test.ts` shows how it is tested. Samples inside
the framework repo set up their stack with `setupTestStack` from
`@cosmicdrift/kumiko-testing/stack` and create tables in the test. In an
app, `setupAppTestStack` and `seedTenant` do that for you; keep the
assertions, take the setup from your scaffolded integration test. Table
setup in sample tests (`unsafeCreateEntityTable`, `createEventsTable`) and
any raw `DELETE FROM` cleanup are framework internals. Never copy them;
isolate tests with one tenant each.

## Package entry points

Import only from these subpaths of `@cosmicdrift/kumiko-framework`. Deep
imports into `src/` or `dist/` break on the next release.

| Subpath | Use it for |
| --- | --- |
| `/engine` | `defineFeature`, `createEntity`, field factories, handler helpers, executors, events |
| `/errors` | Typed failures and error helpers |
| `/stack` | Test stack, `TestUsers`, `createTestUser` |
| `/testing` | Assertion helpers such as `expectErrorIncludes` |
| `/ui-types` | Screen definition types (`EntityListScreenDefinition`, ...) |
| `/db` | `buildEntityTable` and database helpers for tests and migrations |
| `/event-store` | Event store helpers |
