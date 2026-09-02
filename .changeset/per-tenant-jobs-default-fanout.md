---
"@cosmicdrift/kumiko-framework": minor
---

`perTenant` jobs no longer require an app to supply `getActiveTenantIds` when the tenant feature is mounted; the runner resolves tenants itself via the tenant feature's `tenant:query:active-tenant-ids` query, and `server-runtime`/`dev-server` now thread an explicit `getActiveTenantIds` through when an app does provide one. Per-tenant fan-out children now get a deterministic job id derived from the wrapper run, so a perTenant wrapper that fires twice for the same trigger (a retry, a Redis drop, an instance restarting mid-run) no longer enqueues duplicate children per tenant.
