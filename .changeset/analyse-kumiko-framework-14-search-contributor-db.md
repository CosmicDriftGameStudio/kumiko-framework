---
"@cosmicdrift/kumiko-types": patch
"@cosmicdrift/kumiko-framework": patch
---

Search payload contributors now receive a tenant-scoped read handle for the document's tenant.

<!-- kumiko-changes
feature: framework
type: improvement
title: Search payload contributors get a tenant-scoped db
detail: `SearchPayloadContributorFn` receives `db`, a TenantDb scoped to the tenant of the document being indexed (plus system-tenant reference rows), on the live search consumer and in `reindexEntity`. Contributors can now read definitions or reference data, for example to index only fields marked searchable. Existing contributors that ignore the new argument keep working.
-->
