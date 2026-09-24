---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-types": patch
---

The Meilisearch adapter now configures each tenant index on first access from the registry's searchable fields, so search works on every tenant without an app-side `configure()` call. An explicit `configure()` still wins.

<!-- kumiko-changes
feature: framework
type: fix
title: Meilisearch tenant indexes are configured automatically on first access
-->
