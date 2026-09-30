---
"@cosmicdrift/kumiko-framework": patch
---

updateMany drops unknown columns, so replaying an update event for a removed field no longer fails the rebuild

`updateMany` now ignores keys that have no column on the target table, matching `insertOne`/`insertMany`. A historical `<entity>.updated` event that still carries a field removed from the entity no longer aborts a projection rebuild with "column ... does not exist".

<!-- kumiko-changes
feature: framework
type: fix
title: updateMany drops unknown columns, so replaying an update event for a removed field no longer fails the rebuild
-->
