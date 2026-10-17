---
"@cosmicdrift/kumiko-bundled-features": patch
---

Exporting a system template with resources outside the system tenant reports why

<!-- kumiko-changes
feature: template-resolver
type: fix
title: export-bundle for a system template with resources returns a validation error outside the system tenant
detail: A TenantAdmin, or a SystemAdmin outside the system tenant, exporting a system template that links resource files now gets the `system_resources_need_system_tenant` validation error, the same code import-bundle-system uses, instead of a NotFound for the resource file.
-->
