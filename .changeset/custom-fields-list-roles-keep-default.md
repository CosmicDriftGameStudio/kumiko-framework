---
"@cosmicdrift/kumiko-bundled-features": patch
---

custom-fields: the field-definition list roles always include the default `TenantAdmin`, also when `fieldDefinitionWriteRoles` is set. `TenantAdmin` keeps saving values by default, so the form section must keep loading for it; `fieldDefinitionWriteRoles: []` no longer locks out the list.

<!-- kumiko-changes
feature: custom-fields
type: fix
title: field-definition list keeps TenantAdmin when fieldDefinitionWriteRoles is set
migration: |
  No action needed. Set fieldDefinitionListRoles explicitly to narrow the list roles.
-->
