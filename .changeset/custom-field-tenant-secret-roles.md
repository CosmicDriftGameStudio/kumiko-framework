---
"@cosmicdrift/kumiko-bundled-features": minor
---

`custom-fields` gains a `fieldDefinitionWriteRoles` option on `createCustomFieldsFeature` that overrides the roles required for `define-tenant-field`, `update-tenant-field` and `delete-tenant-field` (previously hard-wired to `["TenantAdmin"]`) and feeds into the field-definition list-query default the same way `valueWriteRoles` already does. `secrets` gains `access`/`roles` options on `createSecretsFeature` that override the roles (or open access) required for `set`, `delete` and `list` (previously hard-wired to `["TenantAdmin"]`). Both changes are backward-compatible — the previous hard-wired roles remain the defaults.
