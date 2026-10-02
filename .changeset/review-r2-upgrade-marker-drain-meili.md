---
"@cosmicdrift/kumiko-framework": patch
---

`kumiko upgrade --apply` now refuses to write a marker when no installed Kumiko version can be found under the target, instead of recording the `--from` filter value. It also finds `node_modules/@cosmicdrift/*` packages that are workspace symlinks. `MeilisearchAdapter.dropAllIndexes()` only drops tenant indexes of its own prefix and leaves indexes of a longer sibling prefix alone. `drainJobs()` now rejects when a perTenant fan-out or an unknown job fails before the job body runs.

<!-- kumiko-changes
feature: framework
type: fix
title: Upgrade marker needs an installed version, Meilisearch drop keeps sibling prefixes, drainJobs sees pre-run job failures
-->
