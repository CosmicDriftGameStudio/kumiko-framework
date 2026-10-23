---
status: reference
verified: 2026-10-22
evidence: "Decisions recorded from maintainer sessions; each entry names the code or issue it rests on where one exists."
---

# Design decisions

Append new decisions at the bottom. When a decision is replaced, keep the old entry and mark it "Superseded by ...". Entries dated 2026-09-22 come from older notes without an exact date; those decisions were made on or before that day.

### 2026-06-14 New capabilities extend the existing API

A new capability becomes an optional field on the API everyone already calls, not a second factory or function next to it. A parallel "opt-in" surface never gets adopted, so old call sites stay behind and the code collects near-duplicates. The case that settled it: a fourth config factory for boot configuration was dropped, and `env`, `inheritedToTenant` and `backing` became optional fields on `ConfigKeyOptions`, inherited by the three scope factories. A new surface is only justified when the semantics are truly disjoint.

### 2026-08-19 PII encryption happens only in `append()`

Ciphertext in tables such as the job-run and delivery-attempt stores comes from `crypto/event-pii.ts`, called from the event store's `append()` and driven by the `piiFields` catalog of `r.defineEvent`. Columns and tables know nothing about PII, so any write path that bypasses `append()` stores plaintext without an error. A direct write has to call `encryptPiiValueForSubject` itself. Extending the catalog at runtime does not work, because `configureEventPiiCatalog` replaces it and runs once at boot with the state of all features. Without a configured KMS the result is plaintext by design (documented fail-open), because some apps boot without one. Introduced with fw#2243.

### 2026-08-20 List limits are capped at 200, callers page with a cursor

`MAX_LIST_LIMIT = 200` bounds `entityListSchema.limit` and is clamped again in `resolveListPagination`. It was added as a security fix against unbounded or fractional `LIMIT` in raw SQL (first in 0.201.0, clamp in 0.203.0). A caller that needs a complete set pages through `nextCursor` until it is empty. Lowering the requested limit silently drops rows and is not a fix. The constant is exported from the engine entry, but importing it as a value into client code breaks the browser build, so views use a literal.

### 2026-09-09 Authenticator enrolment and personal access tokens stay custom screens

`auth-mfa` enrolment and `personal-access-tokens` keep `type: "custom"` screens (framework#2312). Both show a secret exactly once (TOTP secret and recovery codes, token plaintext) straight from the write response. The declarative form handler discards everything except the created id, so showing the value declaratively would mean reloading it through a cacheable query, which is the real security defect. Building a write-response display into the framework was rejected as out of scope. Both are deliberate exceptions to the custom-screen migration.

### 2026-09-09 Custom screens are fine when they follow the standard

A screen that is genuinely custom (a gallery, an ad-hoc comparison) may stay custom. It has to use the framework widgets and layout conventions instead of rebuilding cards, forms and button rows by hand. Action buttons belong in the card's `footer` slot, not loose in the body. The `ui-guards` and `primitives-discipline-guard` checks do not cover this (framework#2680), so review has to.

### 2026-09-22 `pii: true` is for crypto-shredding, `encrypted: true` is for secrets

`pii: true` with a subject marker encrypts through the subject KMS so that destroying the subject key makes the ciphertext unreadable. It is transparent to the application: the executor encrypts on write, decrypts on read, and handlers see plaintext. `encrypted: true` goes through the field cipher and is for secrets that must be read back, such as an SMTP password or an external API key. GDPR does not require field encryption. Nothing about access, search, sort or display may be restricted just because a field is `pii: true`.

### 2026-09-22 Event sourcing means no relational pivots

Cross-aggregate views are composed in the read layer from several projections, never with a SQL join over a pivot table. A generic "applies to any entity" feature such as tagging uses a feature-owned projection keyed on `(entityType, entityId)` and merges in the read layer, so it works for every host entity without touching it. Denormalizing a column onto the host entity (the `custom-fields` pattern) is the alternative when the host can declare it. Entity ids are uuid or text, never numbers.

### 2026-09-22 Entity index changes live in `entity.indexes`

`buildEntityTable` derives every unique and composite index from `entity.indexes` each time the table is built, so the migration file is not the source of truth. A hand-written `DROP INDEX` or `CREATE UNIQUE INDEX` disappears at the next destructive projection change and shows up as drift in `kumiko-schema validate`. An index that needs to change is changed in the entity definition. The email index on `user` is global on purpose because the user aggregate is tenant-agnostic, so a per-tenant composite would let one address resolve twice.

### 2026-09-22 Cookie domain widening forbids authenticated writes from tenant subdomains

When `auth.cookieDomain` widens the session cookie across subdomains, the framework requires a static `auth.allowedOrigins` list without wildcards and refuses to boot otherwise (`assertOriginGuardConfig`). A subdomain XSS could read the wide cookie. The consequence for app design is that tenant subdomains can only serve anonymous, read-only content. Authenticated writes belong on one fixed host. `unsafeSkipOriginCheck` with a replacement CSRF defence exists but is a security downgrade and not recommended.

### 2026-09-22 Client screens import from a client-safe `/web` entry

A bundled feature's main index re-exports entity, handlers and executor, which pull `postgres` and Node builtins into the dependency graph. A client screen importing from it fails `bun build --target browser`, and tree-shaking does not reliably save it because of module-level side effects. Every feature with a client surface therefore exposes `<feature>/web/index.ts` (marker `// @runtime client`, own `exports` entry) that re-exports only qualified names, pure helpers, types and components. If the entry is missing it is added to the framework first, not duplicated in the consumer.

### 2026-09-22 One anonymous route uses a path gate, not a second bundle

For a single anonymous route inside an existing SPA, a path gate placed as a client feature gate before the email-password client is enough. It follows the existing `AuthPathGate` pattern and has no session context. `createPublicSurface` (separate entry bundle, host routing, server wiring) is for whole public sites. A new public path must also be reachable through the production host dispatch, so the prod entry point is checked, not only the dev one. Pages rendered inside marketing chrome must not use `<header>` for titles or the sticky title bar of the `Form` primitive, because both collide with the sticky site header.

### 2026-09-22 No guardrails against self-inflicted misuse

Docs, recipes or checks that exist only to stop an app author from doing something that harms nobody but themselves (an untidy settings hub from many one-key features, verbose code, redundant features) are not built. Preventive tooling is reserved for data loss, security and cross-tenant harm.

### 2026-09-25 Dependency outages degrade and recover instead of crashing

When a dependency such as Postgres goes away, the process stays up. It reconnects with backoff and an upper bound, never gives up after N attempts, logs distinct `lost, reconnecting` and `recovered` lines, reports readiness as not ready while liveness stays green, and resumes without a restart. A hard exit is for real programming errors. Crash loops turn a short outage into restarts of every pod with Kubernetes backoff delays of up to five minutes (framework#3243).

### 2026-10-20 Event-fed tables are write-locked at runtime

Tables built by `buildEntityTable` or registered through `r.projection` carry a runtime mark, and every write path (the query helpers, the `ctx.db` methods and `db.global()`) refuses them unless the runner holds a capability that only the framework hands out. It goes to the executor, projection apply and rebuild, declared `unsafeProjection*` steps, tenant-destroy hooks for their own tenant and `deleteRowsWithoutReplayableStream`, which deletes only rows whose stream has no events or is archived. `unsafeRaw()` strips it, so an audited escape hatch still cannot write a read model without an event. The capability sits on a per-grant runner proxy and never on the shared pool or transaction. The compile-time half is a positive brand: a write compiles only for a `Writable` table (`table()`, `defineUnmanagedTable`, `source: "unmanaged"`) or a runner that carries the capability type, and widening a table to a plain schema table drops the brand, so erasure fails closed. The direct-entity-writes guard remains as early warning and for raw SQL. A static guard alone missed casts and type-erased tables, and every miss was a row that a rebuild drops or resurrects.

### 2026-10-20 Feature runtime follows the path

Inside a feature, `web/**` is client-safe code and everything else is server or isomorphic, so the runtime-isolation guard derives the runtime from the path and the `// @runtime client` marker is gone from feature folders. Isomorphic `constants.ts` and `i18n.ts` live under `web/` and the server imports them directly; there is no separate `shared/` folder. Markers remain only outside feature folders (dev, test and tooling files without a path rule). The `feature-layout` codemod moves existing files and `guard-app-feature-structure` flags new markers.

### 2026-10-20 Error classes are closed by types, boot or runtime before a guard

When a guard finds an error class that a type, the boot validator or a runtime check can make impossible, the framework closes it there and the guard goes. A guard stays only where the check needs cross-file context the framework cannot see, or where an export still has legitimate cross-package users (admin-api, restricted-symbols, raw-sql). Placeholder reasons ("todo", "legacy", ...) are rejected at boot for every declared `escapeHatch` and `openToAll`, and at runtime for call-site reasons (`unsafeRaw(reason)`, `acknowledgeCrossTenant`, `unsafeAllTenants`, `declareEscapeHatch`). The accepted trade-off: a new placeholder at a call site that rarely runs surfaces only when that path executes, not in CI. Undeclared `unsafeRaw` or SYSTEM-identity use was already refused at runtime and is no longer flagged statically.

### 2026-10-21 Second guard sweep: runtime, boot and contract tests

The unsafe-append-event guard goes without a replacement, because the event store already rejects unregistered event types and validates every payload at runtime for `appendEvent` and `unsafeAppendEvent` alike. The access-denied-test guard is replaced by the `expectRoleRestrictedHandlersDenyForeignRole` contract helper, which calls every role-restricted write and query handler over HTTP, since roles are enforced centrally before parsing. Locale completeness moves from the i18n-keys guard to the boot validator as a per-feature consistency check: every key carries every locale its feature uses. The PII stance of entity text fields is deterministic: `FieldsMap` requires one by type and boot refuses a text or long-text field without one, while the name heuristic stays a warning and never fails. The qualified-name guard and the i18n used-key-without-definition check stay, because making them type errors would need code generation.

### 2026-10-21 The primitives contract stays, files stay under 2000 lines

`usePrimitives` and `PrimitivesProvider` remain the public seam between screens and their building blocks. Apps override single primitives through it and tests swap them without a DOM, so removing it would break every consumer for no gain. Its docs no longer mention renderer packages that do not exist. Production files in the framework packages stay under 2000 lines, enforced by the file-size guard with a baseline; translation tables (`locale-*/src/strings.ts`) and tests are exempt. Legitimate bridge and boundary casts are counted per package in a second cast baseline, so moving code between files does not trip it while new casts do. Tenant-bound newest-row-per-key reads use `selectMany` with `distinctOn` instead of `unsafeRaw`; a generic custom-SQL read on `TenantDb` was rejected, because the framework cannot prove the tenant filter inside arbitrary SQL without row-level security.

### 2026-10-21 Required locales are an app boot option

An app names the locales it ships in `validateBootOptions.requiredLocales`, and boot fails on any translation key of any mounted feature, framework and bundled ones included, that lacks one of them. The list is not derived from tenant settings: those change at runtime, while the check has to hold for one build in CI (`kumiko-schema validate` reads the same option). Locales are combined across features, so a `locale-*` package closes the gaps of the features it translates; a plain key of a regular feature only counts for that feature, so two features with the same plain key cannot cover each other. Generated labels that only exist in English, such as personal-access-token scopes, get a key helper (`patScopeOptionKey`) instead of a localized `label`, because locales on the defining feature would make every one of its keys need all of them under the per-feature consistency rule.

### 2026-10-21 Cross-tenant reads are a per-handler read-only grant

A tenant-scoped handler or job that only has to read other tenants' rows declares `escapeHatch: { reason, grants: ["crossTenantReads"] }` and gets `ctx.crossTenantReads` (`selectMany`, `fetchOne`, `count`, each call counted in the escape-hatch metric, audited as `cross-tenant-read` once per report window). The grant does not unlock `ctx.db.unsafeRaw()`, writes or `db.global` writes, and neither member-resolution reads nor agent tool calls ever see it: `dispatchToolCall` marks its scope, nested dispatches inherit the marker, and the check also covers a grant implied by `unsafeRaw`. `unsafeRaw` implies it, because the raw runner reads everything anyway, so existing declarations keep working. Lifting the feature to `r.systemScope()` or moving the handlers into a separate system feature was rejected: it widens the scope to every handler of the feature or renames qualified names. The agent check sits in the dispatch rather than in agent exposure, because exposure only decides which handlers an agent may call, while the call itself runs with the user's session and its result lands in the LLM context.

### 2026-10-21 Public packages are MIT, not BUSL-1.1

BUSL-1.1 was chosen in 2026-05 to keep a large vendor from forking the framework into a hosted offering without giving anything back. The review on 2026-10-21 showed the trade-off no longer holds: a framework with one maintainer gains more from adoption and contributors than it loses to a hypothetical fork, BUSL is a sticking point in dependency scans (the own license guard denies it), and the Additional Use Grant forced every hosting question into a mail thread. All `@cosmicdrift/*` packages, `create-kumiko-app` and the repo switch to MIT; the dependency-license exceptions for BUSL stay, because every version up to 0.386.0 was published under it and a consumer may still pin one. Contributions come in under MIT with a DCO sign-off instead of a CLA, so the copyright stays with the contributors and a later relicensing would again need everyone's consent.

### 2026-10-22 Complexity cap 60, files under 1200 lines, projection allowlist at boot

A function above cyclomatic complexity 60 fails the complexity guard in the repo's own files, even with a complexity-budget tag or a baseline entry. The tag and the per-file baseline only cover the range from 15 to 60. Production files stay under 1200 lines, frozen by the file-size baseline as before; this replaces the 2000-line limit from 2026-10-21. `validateBoot` runs `validateProjectionAllowlist`, so a write handler that writes a projection it did not declare, or writes an aggregate table directly, fails at boot instead of passing silently. Aggregate tables are matched by their physical table name.

### 2026-10-22 Billing offers several providers for new checkouts only

`billing-foundation` serves the plan catalog from every mounted provider that exposes `priceToTier` and offers those the system admin has switched live. The customer picks one in the order dialog after choosing a plan. A subscription stays with the provider stored on it for prices, plan switch, portal, cancellation and sync, and a switch never crosses providers, because the provider subscription id only exists at that provider. A provider without a hosted switch page (Dodo Payments) switches plans through a preview in the app and the same consent gate as a checkout, so a plan change never happens without the customer seeing the amount and consenting. Dodo's test or live environment is its own config key next to `billingLive`, so staging can run real test checkouts with billing switched on.

### 2026-10-22 List groups and totals are computed on the server

A grouped list or a totals row shows numbers over the whole filtered result set, never over the rows a page or an infinite scroll has loaded so far. With client-side grouping a group would show only the rows of one page and grow while scrolling, a collapsed group would still load silently, and sums would be page sums that change as the user scrolls. The `list` query therefore takes an optional `aggregate` payload (one `groupBy` field plus `sum`, `avg`, `count`, `min` and `max` measures) that runs over the same where clause as the rows, including ownership, screen filters and the Meilisearch candidate ids, through the existing `aggregate-sql.ts` layer and the same field-read gate as sorting and filtering. The renderer loads groups first and then rows per expanded group with its own cursor, so pages and infinite scroll behave the same in group mode. Table view state (columns, pins, widths, density, grouping) lives in the browser session behind a `ListStateStore` keyed by tenant, user and screen; the URL stays the source of truth for sort, search, page and filters, and nothing about a table view is persisted on the server. Bulk actions call the existing row write handler once per row instead of `/api/batch`, because the batch is atomic and a single rejected row would roll back every other one.

### 2026-10-22 Complexity cap 40

The hard complexity cap drops from 60 to 40 and replaces the cap of 60 from the entry of the same day above. A function above cyclomatic complexity 40 fails the complexity guard in the repo's own files, even with a complexity-budget tag or a baseline entry; the tag and the per-file baseline only cover the range from 15 to 40. The functions that sat between 40 and 60 were dispatch over a closed set of kinds (PII rules, cascade strategies, list columns, cell formats), and a typed table of small rules expresses that with every rule under 30. The thin-wrapper guard therefore no longer reports a function that fills a slot of a typed table (an object literal with a declared type or a `satisfies` check): the table fixes the signature, so inlining the entry would mean dropping the table.

### 2026-10-23 Bun.SQL is the only Postgres driver

Bun.SQL replaces the postgres-js fork (`@bender0oo0/postgres`) behind `createDbConnection`, and the fork leaves the workspace. The only thing that held Bun.SQL back was oven-sh/bun#29484: a prepared statement kept its plan across DDL on the same connection and failed with 0A000, which broke projection rebuilds and column DDL. Bun 1.4.4 fixes it, so the framework requires Bun 1.4.4 or newer and a regression test runs exactly that sequence on one reserved connection. With one driver there is one error shape: the SQLSTATE comes from `errno` and the constraint from `constraint`, read only through `extractPgError`, and connection failures carry Bun's `ERR_POSTGRES_*` codes. `DB_PROVIDER` is refused at boot for every non-empty value, because there is nothing left to select. `onNotice` is gone without a replacement, since Bun.SQL has no notice hook and drops server notices. Keeping postgres-js as a second driver was rejected: two drivers double the parity work on array parameters, instants and savepoint errors that PR #3767 had to do once, and no app imports postgres-js directly.

### 2026-10-23 ts-morph tooling lives in its own package, @cosmicdrift/kumiko-feature-ast

The feature AST (parse, patch, render), the pattern library, the codemod pipeline and the upgrade codemods moved out of `@cosmicdrift/kumiko-framework` into `@cosmicdrift/kumiko-feature-ast`; the framework no longer depends on it and no longer installs ts-morph. They are a library for runtime consumers (the studio designer, the enterprise `ai-generate` feature, the dev server), not a CLI, so a place inside `@cosmicdrift/kumiko-cli` was rejected: the CLI already depends on the dev server, which would close a cycle. Production images that install only the framework drop ts-morph and the TypeScript compiler it bundles. The upgrade codemods keep the `scripts/codemod/` subfolder, so the `codemod` paths in every `changes.json` stay valid, and `kumiko-upgrade` and `kumiko codemod` look for them in this package.

### 2026-10-23 Optional peers fail at the subpath, not at boot

A subpath that needs an optional peer dependency fails on import with `<peer> is not installed. <subpath> needs it as a peer dependency: bun add <peer>@<range>` and is listed in the package's `kumiko.optionalPeerExports`. The framework itself boots without the peer; the first case is `meilisearch` for `@cosmicdrift/kumiko-framework/search/meilisearch`. Only the peer's own "package not found" error is translated, so a missing dependency of the peer still surfaces unchanged. check:dist does not install the peer and checks exactly that message under Node and Bun, and the hero demo refuses to run when meilisearch ended up in the scaffolded app.

### 2026-10-23 Row level security is a second isolation layer, off in production by default

Postgres row level security sits under the tenant filter of TenantDb as a second layer and does not replace it. With `rowLevelSecurity: "on"` every table with a `tenant_id` column, the event store tables included, gets ENABLE and FORCE ROW LEVEL SECURITY and the policies `kumiko_tenant_isolation` and `kumiko_system_tenant_read`, and the connection sets `kumiko.tenant_id` and `kumiko.scope` transaction-locally in every transaction from an ambient scope. TenantDb and dispatch set the tenant; jobs, the event dispatcher, member resolution, migrations, seeds, rebuilds and the other boot paths set the system scope at the call site. A statement without a scope sees no tenant rows. The functions that set a scope are not on the public `db` subpath: the framework packages import them from `internal/row-level-security` and tests from `@cosmicdrift/kumiko-testing/helpers`. Both subpaths are importable by convention only; no guard keeps app production code off them yet. One value in `kumiko.config.ts` drives schema generate, validate and apply and every runner, so the CLI has no flag of its own that could disagree with the runtime. The test stack and the dev server run with it on, as a NOSUPERUSER NOBYPASSRLS role that owns the database; production stays off until the consumer apps run green with it on. At on, boot refuses a role with SUPERUSER or BYPASSRLS and any tenant table without the full set; at off, it refuses a database that still has row level security enabled. Projection rebuilds run under FORCE in system scope instead of turning `row_security` off, after a catalog check under a SHARE UPDATE EXCLUSIVE lock, which blocks policy DDL and a second rebuild of the table, that refuses a RESTRICTIVE policy or a missing isolation policy before the first guard read. A BYPASSRLS maintenance role or a second owner role for rebuilds and migrations was rejected, because a second credential that skips every policy is what this layer exists to rule out. A per-table opt-out flag was rejected too: it hides the exemption in the schema instead of at the code path that needs it. Open before the default flips: event and projection writes run in system scope in this step, so the WITH CHECK clause guards raw SQL and reads but not yet the event write path.

### 2026-10-23 The complexity guard covers .tsx

The complexity guard scans `.tsx` files with the same threshold of 15 and the same hard cap of 40 as `.ts`; `.test.tsx` files stay excluded like `.test.ts`. Conditional JSX (`cond && <X/>`, ternaries in markup) counts as a branch, because a screen with forty conditional slots is as hard to follow as a handler with forty `if`s. A component above the cap is split into a state hook, pure logic modules and `renderX(model)` functions with identical hook order and deps, not into new component layers. Existing `.tsx` hotspots between 15 and 40 were frozen in the baseline when the scan was extended; consumer repos freeze theirs with `--write-baseline` on the bump and split every function above 40.
