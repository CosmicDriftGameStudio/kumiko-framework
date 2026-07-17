---
"@cosmicdrift/kumiko-server-runtime": minor
"@cosmicdrift/kumiko-dev-server": patch
---

Extract `@cosmicdrift/kumiko-server-runtime` as a new package carrying `runProdApp` and its
production-boot dependencies (compose-features, boot seeding/crypto/job-logger,
extra-routes-deps, pii-boot-gate, static-file serving, prod bundle build, session-wiring).

`@cosmicdrift/kumiko-dev-server` now depends on `kumiko-server-runtime` for these shared
pieces instead of bundling them directly, and no longer exports `runProdApp` or
`compose-features` from its own subpaths — apps must import those from
`@cosmicdrift/kumiko-server-runtime` (see the package's README/exports). This is a breaking
change for anyone importing `runProdApp`/`composeFeatures` from `@cosmicdrift/kumiko-dev-server`
directly; `runDevApp` and the rest of `kumiko-dev-server`'s public API are unaffected.

The net effect: a production app that only needs `runProdApp` no longer pulls `ts-morph` and
the scaffolding/codegen toolchain into its `node_modules`.
