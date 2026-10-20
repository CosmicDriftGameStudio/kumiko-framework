---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-testing": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

The compile-time write lock on event-fed tables is fail-closed: a write compiles only for a Writable table or a runner that carries the executor capability, so type-erased tables are rejected instead of accepted.

<!-- kumiko-changes
feature: framework
type: breaking
title: Writes compile only for Writable tables or capable runners
detail: The negative ExecutorOnly brand is replaced by positive brands. table(), defineUnmanagedTable and deriveEntityTableMeta with source "unmanaged" return Writable tables; buildEntityTable and r.projection tables do not. insertOne, updateMany, deleteMany, the upsert and counter helpers and the TenantDb and db.global() write methods accept a Writable table, or any table when the runner is an ExecutorManagedRunner or ExecutorManagedTenantDb. Widening a table to SchemaTable or EntityTableMeta drops the brand, so erased tables no longer compile. Projection apply functions receive tx as ExecutorManagedRunner. The runtime lock is unchanged.
migration: Apply functions that annotate `tx` as `DbRunner`, inline or standalone, type it as `ExecutorManagedRunner` (or drop the annotation / annotate the function with SingleStreamApplyFn/MultiStreamApplyFn). Own write helpers take `WritableTable` for direct-write tables, or `ExecutorManagedRunner` / `ExecutorManagedTenantDb` when they write event-fed tables from an apply, rebuild or tenant-destroy context, instead of `SchemaTable`/`EntityTableMeta`. Tables annotated as `SchemaTable` lose the `Writable` brand; drop the annotation or add `& Writable`. Tenant-destroy hooks keep using the db they receive. Affects kumiko-enterprise, solon, money-horse, kumiko-studio, publicstatus.
-->
