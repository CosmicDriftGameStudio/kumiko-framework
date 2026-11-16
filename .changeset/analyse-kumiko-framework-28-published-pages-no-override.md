---
"@cosmicdrift/kumiko-bundled-features": minor
---

`managed-pages:query:by-tenant-published` no longer takes `tenantIdOverride`.

<!-- kumiko-changes
feature: managed-pages
type: breaking
title: Published page list always reads the caller's tenant
detail: The discovery query accepted a tenantIdOverride that could never reach another tenant through the tenant-scoped read. The field is gone; the query lists the published pages of the caller's tenant.
migration: Drop tenantIdOverride from by-tenant-published calls; use systemQuery with the tenant id, as the seo feature does.
-->
