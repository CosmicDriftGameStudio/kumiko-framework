---
"@cosmicdrift/kumiko-bundled-features": minor
---

Add `@cosmicdrift/kumiko-bundled-features/custom-fields` — B1 phase of the custom-fields-bundle Sprint.

**Contents:**
- `fieldDefinition` entity (event-sourced) — stores tenant-scoped and system-scoped (`tenantId = SYSTEM_TENANT_ID`) custom-field definitions side-by-side
- 4 write-handlers: `define-tenant-field` (TenantAdmin), `define-system-field` (SystemAdmin), `delete-tenant-field`, `delete-system-field`
- 1 query-handler: list (tenant-scoped; B2 will add system+tenant UNION resolution)
- Deterministic aggregate-id from `(tenantId, entityName, fieldKey)` — same-scope conflicts surface naturally as `version_conflict`
- Builder-Reuse-ready: `serializedField` jsonb stores the dehydrated field-builder-options; B2 will rehydrate for value-validation against `customField.set` events

**Not in B1 (deferred to B2):**
- Event-types `customField.set` / `customField.cleared`
- MSP for value-projection in `read_<entity>.customFields` jsonb
- Schema-Migration trigger for jsonb-column on host-entities
- `r.extendsRegistrar("customFields", ...)` + onRegister wiring
- F1 postQuery + F3 search-payload-extension integration
- Cross-scope-conflict (tenant trying to override system fieldKey)
- user-data-rights anonymization wiring
- cap-counter quota wiring on define
- In-place type-change-lock (DELETE+CREATE workaround for v1)

Part of custom-fields-bundle Sprint Phase B1.
