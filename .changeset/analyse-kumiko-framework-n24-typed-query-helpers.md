---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-testing": patch
---

The free query helpers (`selectMany`, `fetchOne`, `insertOne`, `insertMany`, `updateMany`, `upsertOnConflict`, `upsertByPk`, `insertOnConflictDoNothing`, `incrementCounter`, `assertExistsIn`) check their table and db arguments and no longer return `any` rows.

<!-- kumiko-changes
feature: framework
type: breaking
title: Free query helpers are typed
detail: `TableLike` was `EntityTableMeta | any`, `AnyDb` was `DbRunner | unknown` and rows defaulted to `any`, so the type check was off for every free query call. `TableLike` is now `SchemaTable | EntityTableMeta`, `AnyDb` is `DbRunner | TenantDb`, and the default row is `Record<string, unknown>`. `selectMany` and `fetchOne` derive the row from a table built from an entity, like the TenantDb methods already do. `read.findOne` and `read.findMany` steps take a typed table, and the test stack exposes `db` as `DbConnection`.
migration: Type errors show every affected call. A call on a table built from an entity needs no change, its row is derived. On a hand-built table pass the row type, `selectMany<{ readonly jobName: string }>(db, table, where)`, or read a single field as `row["jobName"]`. Type `db` parameters of your own helpers as `DbConnection`, `DbRunner` or `TenantDb` instead of `unknown`. Take row lists as `readonly Row[]`.
affects: selectMany(, fetchOne(, insertOne(, insertMany(, updateMany(, upsertOnConflict(, upsertByPk(, insertOnConflictDoNothing(, incrementCounter(, assertExistsIn(, TableLike, AnyDb
-->
