---
"@cosmicdrift/kumiko-framework": patch
---

Tenant ids from requests are parsed before use and not echoed back in error responses.

<!-- kumiko-changes
feature: framework
type: fix
title: switch-tenant parses the tenant id, tenant errors stop echoing input
detail: `POST /auth/switch-tenant` accepted any non-empty string as `tenantId` and passed it to the membership lookup. It now answers 400 `invalid_tenant` for anything that is not a tenant id. `invalid_tenant_format` no longer returns the raw header or cookie value in `details` (only `source`), and `tenant_mismatch` no longer echoes the `X-Tenant` header.
-->
