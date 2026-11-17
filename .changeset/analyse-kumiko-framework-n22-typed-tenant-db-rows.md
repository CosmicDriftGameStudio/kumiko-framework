---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
---

`ctx.db.selectMany` and `ctx.db.fetchOne` type their rows from an entity table.

<!-- kumiko-changes
feature: framework
type: breaking
title: ctx.db rows are typed from the entity table
detail: Without an explicit type argument, `ctx.db.selectMany(table)` and `ctx.db.fetchOne(table, where)` on a table from `buildEntityTable` or `createEntityExecutor` now return the table's column row (`EntityColumnRow<E>`): every field with its column type, money and locatedTimestamp as their column pair, personal values as stored. `createEntityExecutor` returns `table: EntityTable<E>` instead of the widened `EntityTable`. `EntityRow` and `EntityColumnRow` are exported from the db entry point. An explicit type argument, `options.fields` and tables without entity typing keep `Record<string, unknown>`.
migration: Code that read such rows as `Record<string, unknown>` can now fail to compile where it reads a key the table does not have or assigns the row to an incompatible type. Drop the casts and read the typed fields, or pass the row type explicitly.
-->
