---
"@cosmicdrift/kumiko-framework": patch
---

An entity index where that is not a sql expression now throws

<!-- kumiko-changes
feature: framework
type: fix
title: Non-sql index where throws instead of building a full index
detail: buildEntityTable no longer drops a malformed EntityIndexDef.where silently, which produced a full (unique) index that blocked reuse of soft-deleted values. moneyAmount is typed as a bigint column.
-->
