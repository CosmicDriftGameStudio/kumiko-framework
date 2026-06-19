---
"@cosmicdrift/kumiko-framework": patch
---

Fix `managed-pages:write:set` with `tenantIdOverride` so the SystemAdmin
cross-tenant write is actually idempotent. The handler's `ctx.db` is tenant-
scoped to the *executing* user (createTenantDb "tenant" mode), which was wrong on
both halves of the upsert for an override target: the existing-check
(`fetchOne`) was blind to the target tenant's projection row, so a re-provision
retried as a create and failed with `unique_violation`; and the event-store
executor's stream reads (`getStreamVersion`/`loadAggregate`) ran against the
executor's tenant, so even reaching the update path failed with
`not_found`/`version_conflict`. The fix re-scopes a `TenantDb` to the resolved
target tenant for the existing-check and the executor when an override is set
(SystemAdmin-gated). Covered by three new integration tests (#382/2): override
lands the row under the target tenant, a non-SystemAdmin override is denied, and
an override on an existing page updates it without conflict.
