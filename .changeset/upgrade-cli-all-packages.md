---
"@cosmicdrift/kumiko-framework": patch
---

`kumiko upgrade`'s changelog listing only ever read `packages/framework/src/changes.json` — a breaking change in server-runtime, dev-server, renderer-web, testing, cli, or any other package was invisible to a consumer running the upgrade CLI.

<!-- kumiko-changes
feature: framework
type: fix
title: upgrade-cli now collects every package's changes.json, not just framework's
detail: |
  `findCoreChangelogFile(cwd): string | null` is replaced by
  `findPackageChangelogFiles(cwd): string[]`. In the framework repo itself
  it collects every `packages/<dir>/src/changes.json` except
  `packages/bundled-features` (bundled features are already collected per
  feature dir). In a consumer repo it walks up to 10 levels looking for
  `node_modules/@cosmicdrift/*/src/changes.json`, skipping
  `kumiko-bundled-features`, deduping by package name (nearest
  `node_modules` wins) and by realpath (symlinked workspace copies).
migration: |
  No action needed — `kumiko upgrade` now surfaces more relevant breaking
  changes than before, it never hides ones it previously showed.
-->
