---
"@cosmicdrift/kumiko-bundled-features": minor
---

`cap-overview` shows tenant usage to admins by default again. `caps:usage` and the `my-caps` screen accept TenantAdmin, Admin and SystemAdmin; regular members (`User`, `Editor`) no longer get through unless the app opts in with the new `usageVisibleTo` option. The option is validated when the feature is defined: an empty list or a role the engine does not know throws.

<!-- kumiko-changes
feature: cap-overview
type: breaking
title: caps:usage and my-caps default to admin roles; widen with usageVisibleTo
detail: |
  `createCapOverviewFeature` gets `usageVisibleTo?: readonly string[]`. Without it, the `caps:usage` query and the `my-caps` screen accept `access.admin` (TenantAdmin, Admin, SystemAdmin) instead of every tenant member. The screen and the query share the resolved roles. Only built-in roles are accepted (User, Member, Editor, Admin, TenantAdmin, SystemAdmin); an unknown or empty list throws at feature definition. The SystemAdmin `tenantId` override and the platform-wide screens are unchanged. The `MY_CAPS_ACCESS_ROLES` export is replaced by `DEFAULT_CAP_USAGE_ROLES` (the admin default), and `myCapsScreen` by `createMyCapsScreen(roles)`.
migration: |
  Apps whose regular members should keep seeing their usage pass `createCapOverviewFeature({ ..., usageVisibleTo: ["User", "Editor", "Admin", "TenantAdmin", "SystemAdmin"] })`. Code that imported `MY_CAPS_ACCESS_ROLES` (handlers or nav entries mirroring the screen rule) imports `DEFAULT_CAP_USAGE_ROLES` for the admin default, or reuses the same `usageVisibleTo` array it passed to the feature.
-->
