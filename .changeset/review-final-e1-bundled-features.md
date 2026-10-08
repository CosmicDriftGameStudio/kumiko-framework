---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

Final review batch E1: bundled features

`createTenantFeature` now fails the boot when an `assignableRole` declaration is missing from its `assignableAppRoles` option, because the members and invite screens would otherwise omit the role and a save of the member-roles form would silently strip it. `composeFeatures(includeBundled)` already passes the option. Agent-callable handlers that change access or books now resolve risk `high`: `tenant:write:disable`, `tenant:write:updateMemberRoles`, `user:write:user:update`, `tier-engine:write:set-tenant-tier`, `ledger:write:create-transaction` and `ledger:write:reverse-transaction`. `in_app_messages` gets a `(tenant_id, user_id, created_at)` index. `GET /files/:id/download-url` no longer puts a personal `fileName` into the signed URL; the hint carries a neutral name derived from the MIME type, while `GET /files/:id` still sends the real name in its response header. The forget-subject denial audit event goes through the shared `appendDomainEventCore`, which the pipeline barrel now exports.

<!-- kumiko-changes
feature: tenant
type: breaking
title: createTenantFeature fails the boot when a declared assignable app role is missing from its assignableAppRoles option
migration: Pass assignableAppRoles: collectAssignableAppRoles(appFeatures) to createTenantFeature when you mount it by hand; composeFeatures(includeBundled) already does.
-->

<!-- kumiko-changes
feature: tenant
type: fix
title: tenant:write:disable and tenant:write:updateMemberRoles resolve agent risk high
-->

<!-- kumiko-changes
feature: user
type: fix
title: user:write:user:update resolves agent risk high
-->

<!-- kumiko-changes
feature: tier-engine
type: fix
title: tier-engine:write:set-tenant-tier resolves agent risk high
-->

<!-- kumiko-changes
feature: ledger
type: fix
title: ledger create-transaction and reverse-transaction resolve agent risk high
-->

<!-- kumiko-changes
feature: channel-in-app
type: fix
title: in_app_messages gets a tenant, user, created_at index
migration: Run `kumiko schema generate`; it emits an in-place CREATE INDEX with no DROP and no rebuild.
-->

<!-- kumiko-changes
feature: files
type: fix
title: The signed download URL carries a neutral file name instead of the personal fileName
-->
