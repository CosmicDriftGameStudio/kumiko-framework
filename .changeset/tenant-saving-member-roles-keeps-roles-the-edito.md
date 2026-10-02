---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-locale-de": patch
"@cosmicdrift/kumiko-locale-es": patch
---

Saving member roles keeps roles the editor cannot grant

Admin, TenantAdmin and SystemAdmin saves keep DataProtectionOfficer, TenantOwner, undeclared and higher-tier app roles; the system user still replaces the list. The roles column translates TenantOwner and DataProtectionOfficer. New exports: canActorAssignRole, mergeAssignedRoles, assignableAppRolesOf. Apps translate their roles via tenant:entity:__action-form__:field:roles:option:<Role> (and role:option: for the invite).

<!-- kumiko-changes
feature: tenant
type: fix
title: Saving member roles keeps roles the editor cannot grant
-->
