---
"@cosmicdrift/kumiko-framework": patch
---

`custom-fields`: setting `valueWriteRoles` without `fieldDefinitionListRoles` no
longer breaks asymmetrically. The save path ran with the app roles but the
`field-definition:list` load path stayed on the default `["TenantAdmin"]`, so
app-role users got `access_denied` and the CustomFieldsFormSection never loaded.
When `valueWriteRoles` is set and `fieldDefinitionListRoles` is not, the value
roles now inherit into the list default (unioned with the default so admins keep
list access). Explicit `fieldDefinitionListRoles` still wins.
