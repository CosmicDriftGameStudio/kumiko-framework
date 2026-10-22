---
"@cosmicdrift/kumiko-bundled-features": patch
---

The template `overview` query now uses the same roles as the write handlers: SystemAdmin plus the roles of the `tenantEditable` entries. Before, it was fixed to TenantAdmin and SystemAdmin, so a role that the app opted in saw the screen but got a 403, and a TenantAdmin without an opt-in reached the query and got an empty list.

<!-- kumiko-changes
feature: template-resolver
type: fix
title: overview follows the tenantEditable roles
detail: The overview query takes its access from templateEditAccess(policy.tenantEditable). An opted-in role lists exactly the released templates, and a TenantAdmin without an opt-in is refused with a 403, matching the screen visibility and the write handlers.
-->
