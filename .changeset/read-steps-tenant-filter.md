---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
---

`r.step.read.findOne`/`read.findMany` now apply the caller's tenant filter by default (own tenant + `SYSTEM_TENANT_ID` reference rows), the same as `ctx.db`'s method-form reads — a foreign `where.tenantId` is narrowed to the caller's own scope instead of passing through unfiltered. Cross-tenant reads need `unsafeAllTenants: { reason }` on the step plus `escapeHatch: { reason }` on the handler (or, in a `r.systemScope()` feature, are routed through `ctx.systemDb.unsafeRaw`); a declared cross-tenant read reports an `"unsafe-raw"` escape-hatch audit event, same as `ctx.db.unsafeRaw`.
