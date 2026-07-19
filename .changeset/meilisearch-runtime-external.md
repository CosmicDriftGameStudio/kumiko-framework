---
"@cosmicdrift/kumiko-dev-server": patch
---

`buildServerBundle` (used by `kumiko-build`) moves `meilisearch` from
`BUILD_ONLY_EXTERNALS` to `RUNTIME_EXTERNALS`. Apps importing
`createMeilisearchAdapter` from `@cosmicdrift/kumiko-framework/search/meilisearch`
reference the package at runtime, not just transitively during the build —
without this, the generated `dist-server/package.json` omits `meilisearch`
and the production container crashes on boot with
`Cannot find package 'meilisearch'` (found via a money-horse prod incident).
