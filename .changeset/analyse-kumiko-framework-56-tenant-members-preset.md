---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

`access.tenantMembers` names the role list TenantAdmin plus TenantMember.

<!-- kumiko-changes
feature: framework
type: improvement
title: access.tenantMembers preset
detail: `access.tenantMembers` from `@cosmicdrift/kumiko-framework/engine` is `["TenantAdmin", "TenantMember"]`, the default access of documents, document-draft, signature and presence, which now use it. Apps that repeat this list per feature can use the preset instead. The roles themselves and their assignment rules are unchanged.
-->
