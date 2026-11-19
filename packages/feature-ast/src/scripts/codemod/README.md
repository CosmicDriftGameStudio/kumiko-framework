# Codemods

The codemods a guard points to, plus the upgrade codemods `kumiko-upgrade --apply` runs for releases after 0.420.0. `kumiko codemod <name>` runs the guard ones (preview unless `--write`). Upgrade codemods of a release are deleted once every app is past it (docs/reference/decisions.md, 2026-11-17).

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

Runs via `bun kumiko codemod import-extensions . --write`. Without a mode flag it writes. `--check` exits 1 while any
rewritable or manual site is left. The `import-extensions` guard (`kumiko check guards`) reports
sites that are still on `.js`.

## feature-layout.ts

Applies the feature layout rule "the runtime of a file follows from its path": everything
under `src/features/<feature>/web/` is client code, the rest of the feature is server or
isomorphic. Every file that carries a runtime-client marker outside `web/` moves to
`<feature>/web/` (sub-structure kept), the relative imports, re-exports, `import()` calls and
`mock.module` strings that point at it or out of it are rewritten, `package.json` export
targets follow, and the marker is dropped. A marker the path already implies (client in
`web/`, test in `__tests__/`) is only removed. A `<name>.write.ts`, `<name>.query.ts` or `<name>.job.ts` directly in the feature root moves to `<feature>/handlers/`, `entity.ts` and `<name>.entity.ts` move to `<feature>/schema/`, and a root `client.ts` that defines a `ClientFeatureDefinition` moves to `<feature>/web/index.ts`; a `write.ts` or `queries.ts` with several handlers is reported as manual for a split. `--check` also fails while a move is pending. Idempotent.

```bash
bun node_modules/@cosmicdrift/kumiko-feature-ast/src/scripts/codemod/feature-layout.ts <dir> [--check | --dry-run | --write] [--no-format]
```

Features are found as `src/features/<feature>/` and `bundled-features/src/<feature>/` below
`<dir>`; `--feature-dir <dir>` names a directory that is itself one feature and
`--features-root <dir>` one whose children are features. A target that already exists in
`web/` and a marker no path rule covers (for example `dev` outside `dev/`) are reported as
`manual` and left alone. `--check` exits 1 while anything is left.

## guard-markers-to-lint-ignore

The retired guard opt-out markers move to the one marker syntax: `@no-server-stack: X` becomes
`kumiko-lint-ignore-file test-stack-drift X`, `@timeout-exception: X` becomes
`kumiko-lint-ignore test-timeouts X` and `@template-drift-exception: X` becomes
`kumiko-lint-ignore test-template-drift X`. Only comment lines of `.ts`, `.tsx` and `.mts` files change;
the reason text stays as written. A reason the `ignore-tag-reason` guard reports as too weak
(fewer than three real words) has to be rewritten by hand.

```bash
bun node_modules/@cosmicdrift/kumiko-feature-ast/src/scripts/codemod/guard-markers-to-lint-ignore.ts <dir> [--check | --dry-run | --write] [--no-format]
```

Without a mode flag it writes. `--check` exits 1 while any marker is left.

## registrar-single-form

Every registrar verb takes one options object. Positional calls of `r.optionalRequires`,
`r.readsConfig`, `r.relation`, `r.config`, `r.job`, `r.notification`, `r.referenceData`,
`r.metric`, `r.secret`, `r.secretNamespace`, `r.claimKey` and `r.streamHandler` become the object
form (an options argument that is an object literal is inlined, anything else is spread).
`r.config("key", def)` becomes `r.config({ keys: { key: def } }).key`. `r.useExtension(...)` becomes
`r.applyExtension({ name, entity, ...options })`, and the `biome-ignore lint/correctness/useHookAtTopLevel`
line above it is removed. The receiver has to resolve to a `FeatureRegistrar` (defineFeature callback
parameter or a `FeatureRegistrar`-typed binding).

```bash
bun node_modules/@cosmicdrift/kumiko-feature-ast/src/scripts/codemod/registrar-single-form.ts <dir> [--check | --dry-run | --write] [--no-format]
```

A spread argument, a missing required argument, a receiver that does not resolve, a single argument
that may already be the options object and a `r.config` key that is no identifier are reported as
`manual` and left alone. Calls already in the object form stay unchanged, so a second run is a no-op.
`r.useExtension(` inside strings and Markdown is not touched.

## escape-hatch-grants

`escapeHatch: { reason }` on write and query handlers, hooks and jobs gets the `grants` it needs,
in the order of `ESCAPE_HATCH_GRANTS`. The grants come from the definition literal and, when
`handler` or `run` names a function of the same file, from that function's body: `unsafeRaw(` gives
`unsafeRaw`, `.global(` `globalWrites`, `crossTenantReads` `crossTenantReads`, and `queryAs(`,
`writeAs(`, `createSystemUser(`, `unsafeAllTenants` or `runAs` together with `SystemAdmin` give
`systemIdentity`. `escapeHatch` in `r.applyExtension` / `r.useExtension` options is not touched.

```bash
bun node_modules/@cosmicdrift/kumiko-feature-ast/src/scripts/codemod/escape-hatch-grants.ts <dir> [--check | --dry-run | --write] [--no-format]
```

A declaration without a readable signal, a handler that passes `ctx` to an imported function, an
imported handler and an `escapeHatch` that is no object literal are reported as `manual` ("grants not
inferable"). Run the integration tests of the touched features afterwards: a missing grant only fails
when that code path runs. Declarations that already carry `grants` stay unchanged.

## entity-name

The entity carries its name. Per `createEntity` declaration the codemod collects the names used in
`r.entity({ name, ...entity })`, `r.crud("name", entity)`, `createEntityExecutor("name", entity)`,
`buildEntityTable("name", entity)` and `deriveEntityTableMeta("name", entity)` (symbol resolution, also
across files), writes the first one as `name` into the `createEntity({ ... })` call and drops the name
argument at every use. A use under another name becomes `{ ...entity, name: "other" }`. Inline
`r.entity({ name, fields })` literals stay as they are. Inline `createEntity({...})` or object literals at the call site, names given as constants (resolved by their string literal type), same-file const literals, `as`/alias/single-return factories and sites that already carry the name are handled too; an entity that does not resolve becomes `{ ...entity, name: X }`. Safe to rerun on a partly migrated tree.

```bash
bun node_modules/@cosmicdrift/kumiko-feature-ast/src/scripts/codemod/entity-name.ts <dir> [--check | --dry-run | --write] [--no-format]
```

The analysis spans the whole project root (nearest `biome.json`, `tsconfig.json` there is used for
module resolution), so run it on the directory that holds both the entity declarations and their uses.
A non-literal name, an entity that does not resolve to a `createEntity` call and extra properties in
the `r.entity` literal are reported as `manual`.

## define-handler

Handlers typed with the erased `WriteHandlerDef` / `QueryHandlerDef` move to `defineWriteHandler` /
`defineQueryHandler` (from `@cosmicdrift/kumiko-framework/engine`), so the payload is typed from the
`schema`. Per candidate the codemod

- wraps the object literal in `defineXHandler(...)` and drops the annotation, for `const x: XHandlerDef = { ... }`
  and for functions or arrows with return type `XHandlerDef` and a single `return { ... }` / `=> ({ ... })`;
- drops `event.payload as z.infer<typeof schema>` (also `z.output`, `z.TypeOf` and a same-file alias of
  them) and the `// @cast-boundary ...` comment above it, and turns `schema.parse(event.payload)` into
  `event.payload`, when `schema` is the identifier of the handler's own `schema:` property;
- removes a payload alias, the `z` import and the `XHandlerDef` import specifier when nothing uses them
  any more, and adds the `defineXHandler` import;
- removes only the annotation from a function that returns a call to another converted factory of the same file.

A handler is converted only when every use in the project (test files included, they are never rewritten) is
an argument of `.writeHandler(...)` / `.queryHandler(...)`, an import or re-export, a property read such as
`x.name`, a return of such a forwarding factory, or the first argument of `withCapEnforcement` /
`withStockCap`. Otherwise the file stays as it is and the use is reported with file and line, for example a
handler passed to an app wrapper typed `WriteHandlerDef`, put in an array or stored in an annotated variable.

`kumiko-upgrade --apply` runs it for the release that introduced the typed definitions. By hand:

```bash
bun node_modules/@cosmicdrift/kumiko-feature-ast/src/scripts/codemod/define-handler.ts <dir> [--check | --dry-run | --write] [--no-format]
```

Reported as `manual` and left unchanged: a literal that spreads an identifier, property access or call
(a conditional `...(cond && { ... })` is fine), `satisfies XHandlerDef` and `as XHandlerDef`, several or
non-literal returns, a dynamic schema (a parameter or local of the factory, or a call that does not start with
`z.`), an annotated first handler parameter, `excludedFields` and computed keys. A payload cast to a type
that does not match the schema is kept and reported, the definition itself is converted. Safe to rerun.
The analysis spans the project root (nearest `biome.json`, `tsconfig.json` there is used for module
resolution), so run it on the directory that holds the handlers and their uses.
