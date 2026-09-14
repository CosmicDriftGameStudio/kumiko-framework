---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

Entity-convention handlers (`defineEntity*Handler`, `defineEntityWriteHandler`/`defineEntityQueryHandler`, `registerEntityCrud` write/read) now accept `escapeHatch: { reason }` for one-handler cross-tenant access, reported as an `acknowledge-cross-tenant` audit event the same way the hand-written-handler escape hatches already are. `crossTenant: true` is deprecated: it keeps working, but boot now logs a `deprecation:entity-handler-cross-tenant` warning per handler and its use is audited too; it is planned for removal in a later breaking release. Run `scripts/codemod/migrate-cross-tenant.ts` to migrate — it rewrites `crossTenant: true` to `escapeHatch: { reason }` wherever the handler name and verb can be derived from the call, and lists every other site (shared/spread access objects, `registerEntityCrud` write/read blocks, non-literal values, sites that already declare `escapeHatch`) for manual review. Bundled features migrated: `download-attempt:list`, `export-job:list`, `export-job:detail`, `cap-counter:list`.
