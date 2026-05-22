import {
  createBooleanField,
  createEntity,
  createNumberField,
  createTextField,
} from "@cosmicdrift/kumiko-framework/engine";

// fieldDefinition — Tenant- oder System-scoped Custom-Field-Definition.
//
// **Tenant-Scope:** `tenantId`-Base-Column wird vom Framework automatisch
// gesetzt. Bei system-scope-Definitionen ist `tenantId = SYSTEM_TENANT_ID`;
// bei tenant-scope der current-tenant. Beide leben in derselben Tabelle,
// Scope ergibt sich aus dem tenantId-Wert (no separate `scope`-column).
//
// **Conflict-Rule:** pro (entityName, fieldKey) darf nur eine Definition
// existieren — entweder system oder tenant, nicht beide. Resolution beim
// Read = `WHERE tenantId IN (SYSTEM_TENANT_ID, <current-tenant>)`.
// Conflict-Check ist write-handler-side, NICHT DB-constraint (DB hat
// natürliche UNIQUE auf (tenantId, entityName, fieldKey) durch Aggregate-
// ID-Konstruktion).
//
// **Spec-Drift**: Spec Z.40-54 hat eine separate `custom_field_value`-
// Tabelle. Plan-Doc v2 hat das durch jsonb-on-host-entity ersetzt
// (D2-pur-Storage). Hier definieren wir NUR die definition-Entity; values
// landen in `read_<entity>.customFields` jsonb via MSP (B2).
//
// **Was hier NICHT als Stammfeld-Spalte landet**:
//   - `defaultValue`, `options`, `fieldAccess`, `label` — alles in
//     `serializedField` jsonb gepackt (Builder-Reuse: dehydrierter
//     r.field.X()-Output). Spec Z.18-38 listet sie als separate Spalten,
//     aber Builder-Reuse macht das redundant — der serialized Builder
//     enthält alle diese Aspekte type-safe.
//   - `version` (optimistic-lock) — ES-redundant, wir nutzen aggregate-
//     stream-version (Sprint E-Pattern).
//   - `createdAt/updatedAt/createdBy/updatedBy` — automatic via base-
//     columns + events.
export const fieldDefinitionEntity = createEntity({
  table: "read_custom_field_definitions",
  fields: {
    // Ziel-Entity-Name, für die dieses Field definiert wird (z.B. "property",
    // "customer"). Max 64 char passt zu Kumiko's entity-name-Convention.
    entityName: createTextField({ required: true, maxLength: 64 }),

    // Field-Key (z.B. "internalNumber", "vipFlag") — kebab-case oder camelCase
    // erlaubt; UI-rendering nutzt label statt fieldKey.
    fieldKey: createTextField({ required: true, maxLength: 64 }),

    // Field-Type aus dem SUPPORTED_FIELD_TYPES-Set. Validiert via Zod im
    // write-handler.
    type: createTextField({ required: true, maxLength: 16 }),

    // Required-Flag — wird beim Entity-Write gegen den value gecheckt
    // (Stammfeld-identische Semantik, Spec-Promise Z.4).
    required: createBooleanField({ required: true }),

    // Searchable-Flag — wenn true, contribuiert das Field zum Search-Doc
    // via F3 search-payload-extension.
    searchable: createBooleanField({ required: true }),

    // UI-Display-Order. Tenant kann seine Felder via UI sortieren.
    displayOrder: createNumberField({ required: true }),

    // Builder-Reuse: serialisierter r.field.X(opts)-Output als jsonb.
    // Beinhaltet type-options (enum-values, money-currency, embedded-schema),
    // defaultValue, fieldAccess, i18n-labels. Beim Write-Validation
    // dehydriert der handler dies zurück zu einer r.field.X()-Instanz und
    // nutzt deren .schema für value-Validation.
    serializedField: createTextField({ required: true, maxLength: 65536 }),
  },
});
