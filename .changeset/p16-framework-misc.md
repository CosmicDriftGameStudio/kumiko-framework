---
"@cosmicdrift/kumiko-framework": patch
---

Meilisearch `remove` and `removeBatch` no longer configure (and thereby implicitly create) the tenant index before deleting. `kumiko-upgrade --apply` writes a partial upgrade marker when a later codemod fails, so a re-run resumes at the failed codemod instead of replaying the ones that already wrote files. The changelog lookup claims a package name in the nearest `node_modules` even when it has no `changes.json`, instead of listing a farther version's changelog. The test stack syncs missing indexes (including unique) on a persistent dev DB and removes the BullMQ keys of its derived per-stack queues on cleanup. `bridgeStub` defaults to the real anonymous identity. The `migrate-cross-tenant` and `migrate-db-raw` codemods share one walker with `migrate-open-to-all` that skips symlinks and `dist`/`build`/`.next`/`.git`.

<!-- kumiko-changes
feature: framework
type: fix
title: search remove no longer creates indexes, upgrade --apply keeps a partial marker on codemod failure, test stack syncs indexes and cleans queue keys, codemod walkers skip symlinks
-->
