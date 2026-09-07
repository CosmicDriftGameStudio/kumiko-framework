---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-headless": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

Fix cap-counter's `cap-list` operator screen: the list query now reads across all tenants for SystemAdmin (`crossTenant: true`, matching the export-job-list precedent) and the screen shows a `tenantId` column so a SystemAdmin can see who is consuming what. The boot-validator's entityList column checks and `computeListViewModel` now accept base row-meta columns (id/tenantId/version/insertedAt/modifiedAt/...) as valid list columns, not just declared entity fields.
