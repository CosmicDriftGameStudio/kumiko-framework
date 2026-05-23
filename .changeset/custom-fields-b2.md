---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

**Framework**: add `JsonbFieldDef` + `createJsonbField()` primitive. Schema-less jsonb-Spalte (default `{}`, NOT NULL) für tenant-defined extension-data, AI-inferred metadata, free-form config-blobs. Vs. `embedded` (typed sub-schema): jsonb akzeptiert beliebige keys. Table-builder + schema-builder + e2e-generator alle aktualisiert.

**custom-fields-Bundle (B2)**: ergänzt B1 um Custom-Field-VALUES:
- `customField.set` + `customField.cleared` Event-Types (auf host-aggregate stream)
- `set-custom-field` + `clear-custom-field` write-handlers (emit events)
- `r.extendsRegistrar("customFields")` für consumer opt-in via `useExtension`
- `customFieldsField()` helper für entity-fields-definition
- `wireCustomFieldsFor(r, entityName, entityTable)` consumer-side-API registriert:
  - `r.useExtension("customFields", entity)` opt-in marker
  - MultiStreamProjection: customField.set/.cleared/fieldDefinition.deleted → UPDATE entityTable.customFields jsonb (jsonb_set / minus-operator)
  - `r.entityHook("postQuery", entity, ...)` — flatten row.customFields auf API-root (Spec-Promise "indistinguishable von Stammfeldern")
  - `r.searchPayloadExtension(entity, ...)` — customFields-keys flach ins Meilisearch-Index (F3 wiring)

**Out-of-B2** (future iterations): cross-scope-conflict (tenant override system fieldKey), cap-counter quota, user-data-rights anonymization, value-validation gegen fieldDefinition.serializedField, system+tenant UNION-read.

Part of custom-fields-bundle Sprint Phase B2 (Plan-Doc: kumiko-platform/docs/plans/custom-fields-sprint.md).
