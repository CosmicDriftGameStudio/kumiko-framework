---
"@cosmicdrift/kumiko-testing": minor
---

Export `buildIntegrationTestArgs`/`selectIntegrationFiles` from a new `@cosmicdrift/kumiko-testing/integration-runner` subpath

<!-- kumiko-changes
feature: testing
type: improvement
title: integration-runner exports a dedicated subpath
detail: |
  `buildIntegrationTestArgs` and `selectIntegrationFiles` previously reached
  consumers only through `kumiko-testing`'s own CLI (`kumiko-testing
  integration --parallel N`), with no package subpath a caller outside the
  CLI could import them from. kumiko-framework's own
  `scripts/run-integration-tests.ts` needed exactly that: the same
  `--parallel N --no-isolate` invocation the app template already runs,
  reused instead of reimplemented, while still discovering its own file
  list and running a separate bulk/perf mode split the CLI doesn't have.
  The new `./integration-runner` export makes that reuse
  possible without duplicating the arg-building logic; no existing export
  changed.
-->
