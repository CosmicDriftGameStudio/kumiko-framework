---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

The platform role `TenantOwner` is removed. It did nothing `Admin` does not, and no code granted it.

<!-- kumiko-changes
feature: framework
type: breaking
title: ROLES.TenantOwner is removed
detail: `ROLES` no longer has a `TenantOwner` entry and `"TenantOwner"` is no longer a reserved platform role name, so an app may declare an `assignableRole` with that name. No bundled feature grants or checks the role any more.
migration: Replace `ROLES.TenantOwner` and the string "TenantOwner" with `Admin` (or `TenantAdmin` where the handler also allows it). Remove `TenantOwner` from role lists and translations.
-->

<!-- kumiko-changes
feature: tenant-lifecycle
type: breaking
title: TenantOwner no longer closes the account
detail: `TENANT_ACCOUNT_CLOSE_ROLES` is now `["Admin"]`. `TenantAdmin` is not added, so the set of roles that may request or cancel tenant destruction only loses the removed role.
migration: Grant `Admin` instead of `TenantOwner` to members who close the account.
-->

<!-- kumiko-changes
feature: tenant-inactivity
type: breaking
title: TenantOwner is no longer a keep-account role
detail: `TENANT_KEEP_ACCOUNT_ROLES` is now `["TenantAdmin", "Admin"]`; the inactivity warning mail and the keep-account handlers address these roles only.
migration: Grant `Admin` or `TenantAdmin` instead of `TenantOwner`.
-->

<!-- kumiko-changes
feature: tenant
type: breaking
title: The TenantOwner role option is removed from the member roles form
detail: The role option label `tenant:entity:__action-form__:field:roles:option:TenantOwner` is gone together with the role.
migration: Remove any app translation or screen reference to the `TenantOwner` role option.
-->
