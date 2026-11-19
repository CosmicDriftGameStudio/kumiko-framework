---
"@cosmicdrift/kumiko-bundled-features": patch
---

update-tenant-field checks embedded sub-fields against the stored type, so an embedded field can no longer be stored without a schema by leaving out the type. A definition saved before the sub-field check stays editable as long as its sub-fields are sent unchanged. An embedded field needs at least one sub-field, and set-custom-field refuses keys outside the declared sub-fields.

<!-- kumiko-changes
feature: custom-fields
type: fix
title: update-tenant-field checks embedded sub-fields against the stored definition
detail: The embedded sub-field check of update-tenant-field moved from the payload schema into the handler, which knows the stored type. Before, an update without serializedField.type skipped the check, so an embedded field could be saved without a schema or with unchecked sub-types. update stays a full replacement: an omitted schema removes it, so an embedded field sent without a schema is refused (400 validation_error on serializedField), never kept from the stored definition. A changed sub-field schema that the check refuses is refused the same way. A legacy definition whose stored sub-fields the check would refuse today can still be relabelled or reordered when its schema and currency are sent unchanged. An empty sub-field schema ({}) checked nothing and is now refused by define-tenant-field, define-system-field and update-tenant-field (400 validation_error); a stored legacy definition with an empty schema can still be relabelled when sent unchanged. set-custom-field refuses a value whose row carries a key outside the declared sub-fields (422 custom_field_value_invalid), in a single row and in every row of a multiple field; before, such keys passed the check and were stored as sent. Nothing to do for apps unless a client sends extra keys in an embedded value.
-->
