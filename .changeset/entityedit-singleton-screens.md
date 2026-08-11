---
"@cosmicdrift/kumiko-types": patch
"@cosmicdrift/kumiko-renderer": patch
---

`entityEdit` screens now support `singleton: true` for entities with exactly one record per tenant (organization, settings, tenant profile). A call without an `entityId` resolves the existing record via `<entity>:list` (limit 1) and renders the update branch with prefill on a hit, instead of always rendering an empty create form — so a declarative nav entry can point straight at a singleton edit screen without a wrapping entityList-with-one-row workaround. The create branch (and `allowCreate: false`) still applies when the table is empty.
