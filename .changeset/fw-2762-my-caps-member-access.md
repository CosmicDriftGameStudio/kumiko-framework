---
"@cosmicdrift/kumiko-bundled-features": minor
---

fw#2762: cap-overview's `my-caps` dashboard is now reachable for regular tenant members, not just admins. The `my-caps` screen and the `caps:usage` query that fills its cards both move from `access.admin` to the new exported `MY_CAPS_ACCESS_ROLES` (`["User", "Editor", "TenantAdmin", "Admin", "SystemAdmin"]` — every built-in membership rank from `role-assignment.ts`). Both had to change together: loosening only the screen would render the dashboard and then 403 every card.

This is a strict superset of the previous `access.admin`, so TenantAdmin/Admin/SystemAdmin keep exactly the access they had — no consumer needs to change anything. Deliberately NOT `access.authenticated`, which omits `TenantAdmin` and would have revoked access instead of granting it.

Scope is `my-caps` only. `tenant-cap-list`, `platform-tenant-caps`, the `tenant-caps:list` query and the `tenant-options` query all show foreign tenants and stay `SystemAdmin`-only. The tenant boundary is unchanged: `crossTenantOverrideDenied` still rejects the `tenantId` override for anyone but SystemAdmin, so a regular member can only ever read their own tenant's caps.

Apps that gate the nav entry themselves (and `admin-shell:nav:my-caps`, which stays `access.admin` because it lives in an admin-only workspace) still control visibility on their side — `MY_CAPS_ACCESS_ROLES` is exported so they can mirror the exact rule instead of duplicating the list.
