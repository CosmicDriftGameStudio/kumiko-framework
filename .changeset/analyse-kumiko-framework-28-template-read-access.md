---
"@cosmicdrift/kumiko-bundled-features": minor
---

`template-resolver:query:find-by-id` and `:list` follow the template edit policy instead of admitting every User.

<!-- kumiko-changes
feature: template-resolver
type: breaking
title: Template reads follow tenantEditable roles
detail: find-by-id and list were open to TenantAdmin, SystemAdmin and every User, while a role unlocked through tenantEditable was refused. They now admit SystemAdmin, TenantAdmin and the roles listed in tenantEditable, the same rule as body-preview; a plain User gets 403.
migration: If plain members must read templates, list their role in the tenantEditable entries of createTemplateResolverFeature.
-->
