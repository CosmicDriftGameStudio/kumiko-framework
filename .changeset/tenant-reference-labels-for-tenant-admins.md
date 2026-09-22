---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-framework": patch
---

Tenant reference columns show display names for TenantAdmins, not only SystemAdmins (fw#3142)

Every `tenant:tenant` reference (the delivery-log tenantId column, `LIST_ROW_META_REFERENCES.tenantId`, and any screen that references a tenant) resolved its label through the entity-convention query `tenant:query:tenant:list`. That handler is a SystemAdmin-only entity-list handler, so a TenantAdmin got a 403 and every cell fell back to the raw UUID.

The entity-convention handler stays SystemAdmin-only. Instead the new `tenant:query:tenant-directory` (`access.admin`) returns just `{ id, label }` pairs: an admin gets their own tenant, a SystemAdmin keeps the global reach of `tenant:query:tenant:list`. The query is not exposed to agents. The central `REFERENCE_LOOKUP_SOURCES` map in `@cosmicdrift/kumiko-framework/ui-types` now routes `tenant:tenant` lookups there, the same way it already routes `user:user` lookups to the member directory (fw#3107).

<!-- kumiko-changes
feature: tenant
type: improvement
title: Tenant reference columns show display names for TenantAdmins (fw#3142)
migration: No code change needed. A `tenant:tenant` reference picker or column in an edit form or list now shows a non-SystemAdmin their own tenant's name instead of failing with a 403 and falling back to the raw id. Set `optionsQuery` on the reference field if a screen needs a different source.
-->
