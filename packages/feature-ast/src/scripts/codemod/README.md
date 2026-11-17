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
`web/`, test in `__tests__/`) is only removed. Idempotent.

```bash
bun node_modules/@cosmicdrift/kumiko-feature-ast/src/scripts/codemod/feature-layout.ts <dir> [--check | --dry-run | --write] [--no-format]
```

Features are found as `src/features/<feature>/` and `bundled-features/src/<feature>/` below
`<dir>`; `--feature-dir <dir>` names a directory that is itself one feature and
`--features-root <dir>` one whose children are features. A target that already exists in
`web/` and a marker no path rule covers (for example `dev` outside `dev/`) are reported as
`manual` and left alone. `--check` exits 1 while anything is left.
