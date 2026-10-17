# consumer-facing codemods

This directory holds the codemod scripts `kumiko upgrade --apply` runs for
consumers of `@cosmicdrift/kumiko-framework`. It ships as part of the
published package (under `src/`), unlike `scripts/codemod/` at the repo
root, which is internal bun-cutover tooling for this repo's own migration
and never gets published.

`crypto-shredding-testing-move.ts` rewrites the moved
`resetPiiSubjectKmsForTests` import path; it's wired into
`packages/bundled-features/src/crypto-shredding/changes.json`'s `codemod`
field and runs automatically via `kumiko upgrade --apply`.

## pii-personal-migration.ts

Migrates `create*Field(...)` calls from the old flag-based PII API (`pii`,
`userOwned`, `tenantOwned`, `subjectRef`, `allowPlaintext`, `lookupable`,
`searchable`, `sensitive`) to the author-facing `personal`/`find` API
(kumiko-framework#2250). Idempotent — safe to re-run against already
migrated code (no-ops on fields carrying `personal`).

`createTenantConfig`/`createUserConfig`/etc. are out of scope by
construction (name doesn't match `create*Field`).

```bash
bun node_modules/@cosmicdrift/kumiko-framework/src/scripts/codemod/pii-personal-migration.ts <targetDir> [--dry-run]
```

Anything it can't map mechanically (two subject flags on one field,
`sensitive` + `lookupable`/`searchable` together, `piiEncrypted` on an
entity field, a raw object literal with subject flags outside a
`create*Field(...)` call) is reported with file:line instead of guessed
at — fix those by hand. The report also lists every field that newly
gains `lookupable` (searchable-only fields resolving to `find: "fuzzy"`)
— each of those needs a `_bidx` column migration, which this script does
not write.

## object-form.ts

Rewrites the positional registrar calls `r.writeHandler(name, schema, handler, options)`,
`r.queryHandler(…)`, `r.entity(name, definition, { table })`, `r.requires("a", "b")` and
`r.hook(type, target, fn, options?)` to their object form, and
`registerEntityCrud(r, name, entity, options?)` to `r.crud(name, entity, options?)`
(the now-unused import is removed). Idempotent — object-form calls are left alone.

A call is only touched when its receiver is provably a feature registrar: a parameter of
the `defineFeature(name, (r) => …)` callback, or a binding typed `FeatureRegistrar`.
Anything else (`sessions.requires("x")`, `foo.entity(…)`) stays untouched. A call on an
untyped `r`/`registrar` it cannot resolve, a spread argument, too few arguments or
`entity` options other than `{ table }` are reported as `manual` instead of guessed at.

```bash
bun node_modules/@cosmicdrift/kumiko-framework/src/scripts/codemod/object-form.ts <dir> [--check | --dry-run | --write] [--no-format]
```

Runs automatically via `bun kumiko-upgrade --apply`. Without a mode flag it writes, then
formats the changed files with the Biome binary found in `node_modules/.bin` (`--no-format`
skips that). `--dry-run` only reports; `--check` reports and exits 1 while any rewritable
or manual site is left.

## db-factory.ts

Moves consumers to the single DB connection factory and the relocated query helpers.
`@cosmicdrift/kumiko-framework/bun-db` imports (including `import type`, `export … from` and
`import("…")` types) are repointed to `@cosmicdrift/kumiko-framework/db`, merged into an existing
`/db` import of the same kind. `createDbConnection(url, options)` becomes
`createDbConnection({ url, ...options })`; `createConnection`/`createPgConnection` from the
framework become `createDbConnection` in the object form, and the now-pointless `await` is dropped.
Idempotent. Local functions named `createConnection` are left alone.

Reported as `manual` instead of guessed at: imports of `createBunDbConnection`,
`bunDbConnectionOptionsFromEnv`, `BunDbConnection`, `BunDbTx`, `BunDbRunner`,
`BunDbConnectionOptions` and `DbPoolHandle` (removed without replacement), uses of `DB_PROVIDER`,
and `createConnection` results that are not awaited directly.

```bash
bun node_modules/@cosmicdrift/kumiko-framework/src/scripts/codemod/db-factory.ts <dir> [--check | --dry-run | --write] [--no-format]
```

Runs automatically via `bun kumiko-upgrade --apply`. Without a mode flag it writes, then formats the
changed files with Biome. `--check` exits 1 while any rewritable or manual site is left.
