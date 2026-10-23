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
bun node_modules/@cosmicdrift/kumiko-feature-ast/src/scripts/codemod/pii-personal-migration.ts <targetDir> [--dry-run]
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
bun node_modules/@cosmicdrift/kumiko-feature-ast/src/scripts/codemod/object-form.ts <dir> [--check | --dry-run | --write] [--no-format]
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
bun node_modules/@cosmicdrift/kumiko-feature-ast/src/scripts/codemod/db-factory.ts <dir> [--check | --dry-run | --write] [--no-format]
```

Runs automatically via `bun kumiko-upgrade --apply`. Without a mode flag it writes, then formats the
changed files with Biome. `--check` exits 1 while any rewritable or manual site is left.

## tenant-db-options.ts

Moves `createTenantDb(db, tenantId, mode, tracer, meter, signal, grants)` to the options object
`createTenantDb({ db, tenantId, mode, tracer, meter, signal, grants })`. A call is only touched when
the callee resolves (import, aliased import, namespace import or `await import(…)` destructuring) to
the framework export; a local function with the same name is left alone. Arguments that are the
identifier of the same name become shorthand, literal `undefined` arguments after `tenantId` are
dropped, an explicit `mode` is kept, comments between the arguments are preserved. Idempotent —
calls already passing one object literal are left alone.

Reported as `manual` instead of guessed at: spread arguments, more than seven arguments, a single
argument that is not an object literal, and `createTenantDb` used as a value (callback, assignment,
`.bind`/`.call`/`.apply`).

```bash
bun node_modules/@cosmicdrift/kumiko-feature-ast/src/scripts/codemod/tenant-db-options.ts <dir> [--check | --dry-run | --write] [--no-format]
```

Runs automatically via `bun kumiko-upgrade --apply`. Without a mode flag it writes, then formats the
changed files with Biome. `--check` exits 1 while any rewritable or manual site is left.

## import-extensions

Relative imports name the TypeScript source file: `./foo.js` becomes `./foo.ts`, `./Comp.jsx`
becomes `./Comp.tsx`. Covers `import`, `export ... from`, `import type`, `import()` and
`mock.module`. A specifier is rewritten only when the target exists with the new extension next to
the importer; otherwise it is reported as `manual` and left alone.

The tsconfig that compiles the code needs `allowImportingTsExtensions` and
`rewriteRelativeImportExtensions` (TypeScript 5.7 or newer) first.

```bash
bun node_modules/@cosmicdrift/kumiko-feature-ast/src/scripts/codemod/import-extensions.ts <dir> [--check | --dry-run | --write] [--no-format]
```

Runs via `bun kumiko-upgrade --apply`. Without a mode flag it writes. `--check` exits 1 while any
rewritable or manual site is left. The `import-extensions` guard (`kumiko check guards`) reports
sites that are still on `.js`.

## remove-engine-payload-casts.ts

`executor.detail()` and `executor.list()` from `createEntityExecutor` / `createEventStoreExecutor`
return the entity's own row type (`EntityRow<E>`), so `row["f"] as T`, `row as T` and
`(await executor.detail(…)) as unknown as T` are usually redundant. The codemod removes such a cast,
and its `@cast-boundary` marker comment when no other cast stays in the statement, only when the
operand derives from an executor read (directly, through `rows[0]`, property access, `??` or a
single-assignment variable) and the type checker says its type is assignable to the cast target. A
file is left untouched if removing the casts would add type errors to it.

It type-checks against the tsconfig at or above each file, so run it with the new framework version
installed. Reported as `manual` and left alone: casts the row type does not satisfy (for example a
nullable column cast to a non-null type, or `rows[0]` under `noUncheckedIndexedAccess`), and files
without a tsconfig. A call site that still needs a narrower type than the row gives keeps its cast.

```bash
bun node_modules/@cosmicdrift/kumiko-feature-ast/src/scripts/codemod/remove-engine-payload-casts.ts <dir> [--check | --dry-run | --write] [--no-format]
```

Runs via `bun kumiko-upgrade --apply`. Without a mode flag it writes, then formats the changed files
with Biome. `--check` exits 1 while any rewritable or manual site is left.

## package-merge.ts

Packages folded into another package stay as re-export shims for one wave. The codemod rewrites
imports, re-exports, `import("…")` and `mock.module` specifiers (including subpaths) of the old
package to the new one, and in `package.json` replaces the old dependency with the target package
(same version range, same block, skipped when the block already lists it). The moves are the rows
of `PACKAGE_MERGE_MAPPINGS`: `@cosmicdrift/kumiko-http` to `@cosmicdrift/kumiko-framework/http`,
`@cosmicdrift/kumiko-repo-manifest` to `@cosmicdrift/kumiko-guards/repo-manifest`,
`@cosmicdrift/kumiko-headless` to `@cosmicdrift/kumiko-renderer/headless` (subpaths keep their name),
`@cosmicdrift/kumiko-dispatcher-live` to `@cosmicdrift/kumiko-renderer/live`,
`@cosmicdrift/kumiko-renderer-web` to `@cosmicdrift/kumiko-renderer/web` (so
`@import "@cosmicdrift/kumiko-renderer-web/styles.css"` becomes
`@import "@cosmicdrift/kumiko-renderer/web/styles.css"`).

`.css` files are covered too: the specifier of `@import`, `@plugin` and `@config` is rewritten like
an import. A `@source` path into `node_modules/<old package>/…` has no mechanical target and is
reported as manual.

```bash
bun node_modules/@cosmicdrift/kumiko-feature-ast/src/scripts/codemod/package-merge.ts <dir> [--check | --dry-run | --write] [--no-format]
```

Runs via `bun kumiko-upgrade --apply`. Without a mode flag it writes. `--check` exits 1 while any
site is left. Run your package manager's install afterwards to refresh the lockfile.

## feature-layout.ts

Applies the feature layout rule "the runtime of a file follows from its path": everything
under `src/features/<feature>/web/` is client code, the rest of the feature is server or
isomorphic. Every file that carries a runtime-client marker outside `web/` moves to
`<feature>/web/` (sub-structure kept), the relative imports, re-exports, `import()` calls and
`mock.module` strings that point at it or out of it are rewritten, `package.json` export
targets follow, and the marker is dropped. A marker the path already implies (client in
`web/`, test in `__tests__/`) is only removed. Idempotent.

```bash
bun node_modules/@cosmicdrift/kumiko-feature-ast/src/scripts/codemod/feature-layout.ts <dir> [--check | --dry-run | --write] [--no-format]
```

Features are found as `src/features/<feature>/` and `bundled-features/src/<feature>/` below
`<dir>`; `--feature-dir <dir>` names a directory that is itself one feature and
`--features-root <dir>` one whose children are features. A target that already exists in
`web/` and a marker no path rule covers (for example `dev` outside `dev/`) are reported as
`manual` and left alone. `--check` exits 1 while anything is left.

## feature-ast-package.ts

The feature AST, the pattern library and the codemod pipeline moved from `@cosmicdrift/kumiko-framework`
to `@cosmicdrift/kumiko-feature-ast`. The codemod moves the 36 names (`parseFeatureFile`, `renderFeatureFile`,
`PATTERN_LIBRARY`, `FeaturePattern`, ...) out of `@cosmicdrift/kumiko-framework/engine` imports and re-exports,
splitting a declaration that also imports other names, and renames `@cosmicdrift/kumiko-framework/engine/codemod`
to `@cosmicdrift/kumiko-feature-ast/codemod`. `type` modifiers and `as` aliases stay. A namespace import that reads
a moved name is reported as `manual`. In `package.json` it adds `@cosmicdrift/kumiko-feature-ast` next to
`@cosmicdrift/kumiko-framework` (same range, same block) when the package's sources use the moved API.

```bash
bun node_modules/@cosmicdrift/kumiko-feature-ast/src/scripts/codemod/feature-ast-package.ts <dir> [--check | --dry-run | --write] [--no-format]
```
