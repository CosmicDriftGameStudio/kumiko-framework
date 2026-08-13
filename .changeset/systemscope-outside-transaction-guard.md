---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-types": patch
---

`ctx.dbOutsideTransaction` is now fail-closed on `r.systemScope()` handlers, the same way `ctx.db` already was: touching it directly throws instead of handing back an unfiltered cross-tenant `TenantDb`. The guarded escape hatch is `ctx.systemDb.outsideTransaction`, a new pair of `assertTenantMatch(tenantId)` / `acknowledgeCrossTenant(reason)` methods mirroring the existing `ctx.systemDb.assertTenantMatch`/`acknowledgeCrossTenant`, but backed by the unbound-pool `dbOutsideTransaction` instead of the in-tx `db`.

`UncheckedSystemDb` (`@cosmicdrift/kumiko-types`) gains a new required `outsideTransaction` member. `createUncheckedSystemDb`'s new second parameter is optional, so every existing call site keeps compiling unchanged; a hand-built `UncheckedSystemDb` object literal (none found in this repo) would need to add the new member. No handler currently reads `ctx.dbOutsideTransaction` directly on a `systemScope()`'d feature, so this closes a gap rather than fixing an active bug — but it is a real behavior change: the guard is a Proxy (truthy), so a bare `if (ctx.dbOutsideTransaction)` presence check on a system-scoped handler now passes and then throws on first property access, instead of silently handing back an unfiltered cross-tenant `TenantDb`.
