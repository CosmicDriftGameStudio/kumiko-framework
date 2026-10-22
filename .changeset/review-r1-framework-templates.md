---
"@cosmicdrift/kumiko-bundled-features": patch
---

Template resolver and directory fixes: linking a PDF no longer replaces an inline image under the same key, by-tenant loads shadowing system templates once per kind instead of per row, tenant-override-counts reads only the columns it needs, tenant-overrides resolves labels for exactly the tenants and users it lists (tenant and member directories accept an optional ids filter), and array parameters of the notification preference and form-draft cleanup queries use Postgres array literals.

<!-- kumiko-changes
feature: template-resolver
type: fix
title: Template overrides, key collisions and by-tenant queries
detail: link-pdf refuses a key that already holds an inline image (key_in_use). by-tenant no longer runs a query per row, tenant-override-counts selects only the needed columns, and tenant-overrides resolves names beyond the first 200 tenants or users through the new ids filter of the tenant and member directories. Notification preference and form-draft cleanup queries bind array parameters as Postgres array literals.
-->
