---
"@cosmicdrift/kumiko-guards": patch
---

Direct-entity-writes guard now recognises event-store tables of external packages through a `kumiko-es-tables.json` catalog that each published package ships, and treats `r.projection({ table })` tables as event-fed. Consumers get new findings once they install package versions that contain the catalog.

<!-- kumiko-changes
feature: guards
type: fix
title: Direct-entity-writes guard catches external and projection event-store tables
detail: Published packages list their event-store tables in kumiko-es-tables.json, which the guard checks for staleness in the owning repo and reads in consumers. r.projection tables are now guarded as well. Existing consumers can get new findings that were previously hidden.
-->
