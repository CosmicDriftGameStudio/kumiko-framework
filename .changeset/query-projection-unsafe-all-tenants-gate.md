---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

`ctx.queryProjection(qualifiedName, { unsafeAllTenants: true })` now requires a grant (fw#2913): an `r.systemScope()` feature, or a declared `escapeHatch: { reason }` on the write/query/stream handler (or the `r.hook(...)` call, when the read happens inside a lifecycle hook — a hook never inherits its enclosing handler's grant, not even from an `r.systemScope()` feature, only its own declared `escapeHatch`). Without one, the call throws `AccessDeniedError` with `details.reason: "unsafe_all_tenants_denied"`. A granted call reports exactly one `unsafe-all-tenants` event through the existing escape-hatch audit sink. `defineProjectionQueryHandler` gained an `escapeHatch` option so a projection list-handler can declare the grant.

Also fixes projection tenant-filtering for plain `EntityTableMeta` tables (`defineUnmanagedTable`/`deriveEntityTableMeta`, no drizzle `SchemaTable` symbols): `ctx.queryProjection` previously read `table.tenantId` directly, which is always `undefined` on such tables, so their rows were never tenant-filtered. It now reuses `hasTenantColumn`, the same canonical-meta check `TenantDb`'s other escape hatches already use — an internal `framework/db/tenant-db` helper, not a public package export.
