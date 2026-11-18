---
"@cosmicdrift/kumiko-testing": patch
---

The e2e teardown also drops Meilisearch indexes of earlier runs that are older than a day.

<!-- kumiko-changes
feature: testing
type: fix
title: e2e teardown sweeps Meilisearch indexes of killed runs
detail: Besides the indexes of its own run, the global teardown of `defineAppE2eConfig` now drops every index whose uid starts with `e2e_` and whose `createdAt` is more than 24 hours old, across all pages of the index listing. Indexes of aborted runs, of configs that replaced `globalTeardown` and of indexes created while a teardown was running no longer pile up; the next teardown a day later removes them. Younger `e2e_` indexes stay, so parallel runs keep theirs, and indexes without the `e2e_` prefix are never touched. A failed delete of an old index is written to stderr and does not fail the run.
-->
