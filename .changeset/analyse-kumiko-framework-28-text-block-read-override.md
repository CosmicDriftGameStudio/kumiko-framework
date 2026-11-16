---
"@cosmicdrift/kumiko-bundled-features": minor
---

Text-block and collection reads accept `tenantIdOverride` only as `SYSTEM_TENANT_ID`.

<!-- kumiko-changes
feature: template-resolver
type: breaking
title: Read override on text blocks narrows to SYSTEM only
detail: by-slug, by-tenant and the collection list and item queries took any tenant id as tenantIdOverride, but a tenant-scoped read reaches only the caller's own tenant plus SYSTEM, so a foreign id silently returned the caller's own and SYSTEM rows. The override now accepts SYSTEM_TENANT_ID only (still SystemAdmin only) and any other value fails validation.
migration: Pass SYSTEM_TENANT_ID or no override. Reads of another tenant's content go through a server-side systemQuery for that tenant.
-->
