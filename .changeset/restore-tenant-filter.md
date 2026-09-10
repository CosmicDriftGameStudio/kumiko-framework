---
"@cosmicdrift/kumiko-framework": patch
---

Fix cross-tenant data access in the entity `restore` verb. `restore()` loaded its
target row with an unfiltered raw query, so a caller holding the write role could
un-delete a soft-deleted row belonging to another tenant and receive the
decrypted row in the response. It now reads through the tenant-scoped `TenantDb`,
matching `delete()`. Handlers that opt into `crossTenant: true` and
`r.systemScope()` features keep their unfiltered access.
