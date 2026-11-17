---
"@cosmicdrift/kumiko-dev-server": patch
---

The scaffolded demo tasks feature now registers its CRUD handlers with `r.crud` instead of five hand-written entity handlers.

<!-- kumiko-changes
feature: scaffold
type: improvement
title: Scaffolded tasks feature uses r.crud
detail: `kumiko new app` writes a tasks feature that registers the entity and its create, update, delete, list and detail handlers through one `r.crud(taskEntity, { write, read, descriptions })` call. Handler names and access stay the same; existing apps are not affected.
-->
