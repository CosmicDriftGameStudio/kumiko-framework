---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
---

`access` is now required on every handler definition (`openToAll: true` still compiles but is deprecated in favor of `openToAll: { reason: "..." }`, and a boot validator now rejects an empty reason or a write handler that accepts personal-data fields under `openToAll` without `publicIntake: true`); `EntityDefinition.tenancy: "global" | "tenant"` plus `TenantDb.global(table)` let a "global" table's rows be reached across every tenant (writes gated by a write handler's `escapeHatch: { reason }`); `UncheckedSystemDb.unsafeRaw(reason)` replaces the now-`@deprecated` `TenantDb.raw` escape hatch with an auditable, named declaration.
