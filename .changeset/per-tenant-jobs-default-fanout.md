---
"@cosmicdrift/kumiko-framework": minor
---

`perTenant` jobs no longer require an app to supply `getActiveTenantIds` when the tenant feature is mounted; the runner resolves tenants itself via the tenant feature's `tenant:query:active-tenant-ids` query, and `server-runtime`/`dev-server` now thread an explicit `getActiveTenantIds` through when an app does provide one.
