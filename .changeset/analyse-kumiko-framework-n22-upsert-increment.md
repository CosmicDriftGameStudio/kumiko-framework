---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-types": patch
---

`ctx.db.upsert` takes `increment` to count up a column atomically in the caller's tenant.

<!-- kumiko-changes
feature: framework
type: improvement
title: ctx.db.upsert counts atomically with increment
detail: `ctx.db.upsert(table, values, { conflictTarget, increment: { hits: 1 } })` adds the delta to the stored value on a conflict and inserts values.hits or the delta otherwise, in one statement and only in the caller's tenant. Parallel calls on the same key add up exactly, so a counter no longer needs a read-modify-write loop with retries or a hand-written SQL literal that names the table. The column must be numeric and must not be part of the conflict target or primary key, and a field cannot be in update and increment at once.
-->
