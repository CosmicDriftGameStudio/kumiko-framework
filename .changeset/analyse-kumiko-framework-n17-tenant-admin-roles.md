---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-framework": patch
---

A user with only `TenantAdmin` can close, rename and inspect their own tenant and read its attached files, like an `Admin`.

<!-- kumiko-changes
feature: tenant-lifecycle
type: fix
title: TenantAdmin is no longer locked out of tenant administration
detail: `TENANT_ACCOUNT_CLOSE_ROLES` is now `["TenantAdmin", "Admin"]`, so request-destruction and cancel-destruction accept a TenantAdmin. `tenant:write:update`, `rate-limiting:query:status` and `user-data-rights:query:list-download-attempts` accept TenantAdmin next to Admin and SystemAdmin, and the default file guard's `DEFAULT_PRIVILEGED_ROLES` is `["TenantAdmin", "Admin", "SystemAdmin"]`. A TenantAdmin still only reaches their own tenant; SystemAdmin stays the only cross-tenant role.
-->
