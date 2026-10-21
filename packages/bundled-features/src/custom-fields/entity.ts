import {
  createBooleanField,
  createEntity,
  createNumberField,
  createTextField,
} from "@cosmicdrift/kumiko-framework/engine";

// fieldDefinition — Tenant- or system-scoped custom-field definition.
//
// **Tenant scope:** The `tenantId` base column is set automatically by the
// framework. For system-scope definitions, `tenantId = SYSTEM_TENANT_ID`;
// for tenant-scope definitions, it is the current tenant. Both use the same
// table; the scope is determined by the tenantId value (no separate `scope`
// column).
//
// **Conflict rule:** only one definition may exist per (entityName, fieldKey)
// — either system or tenant, not both. Resolution on read = `WHERE tenantId IN
// (SYSTEM_TENANT_ID, <current-tenant>)`. The conflict check is performed by
// the write handler, NOT enforced by a DB constraint (the DB has a natural
// UNIQUE constraint on (tenantId, entityName, fieldKey) through aggregate-ID
// construction).
//
// **Spec drift**: Spec Z.40-54 defines a separate `custom_field_value` table.
// Plan-Doc v2 replaced it with jsonb on the host entity (pure jsonb storage).
// This defines ONLY the definition entity; values land in
// `read_<entity>.customFields` jsonb via MSP.
//
// **What is NOT stored as a base-field column here**:
//   - `defaultValue`, `options`, `fieldAccess`, `label` — all packed into
//     `serializedField` jsonb (builder reuse: dehydrated
//     r.field.X()-output). Spec Z.18-38 lists them as separate columns, but
//     builder reuse makes that redundant — the serialized builder contains all
//     these aspects in a type-safe form.
//   - `version` (optimistic lock) — redundant with event sourcing; we use the
//     aggregate stream version.
//   - `createdAt/updatedAt/createdBy/updatedBy` — automatic through base
//     columns and events.
export const fieldDefinitionEntity = createEntity({
  table: "read_custom_field_definitions",
  description:
    "One custom-field definition: the host entity it extends, the field key, its type and required/searchable flags, a display order, and the serialized field builder that carries the type options, default value and labels. Rows owned by the system tenant apply to every tenant; all others belong to the tenant that defined them.",
  // softDelete is required, NOT cosmetic: the aggregate-id is deterministic
  // (uuidv5(tenantId|entityName|fieldKey)), so deleting a definition leaves a
  // (created+deleted) event stream under that id. A hard delete would force the
  // next define to create() at version 0 onto that stream → version_conflict —
  // a deleted (entity, fieldKey) could never be re-defined. With softDelete the
  // define handlers resurrect via restore()+update() (see define-or-resurrect).
  // NB: `retention.strategy` below is the data-retention purge policy, a
  // SEPARATE knob from this executor flag — it does not drive executor.delete.
  softDelete: true,
  // Retention policy — field definitions are tenant-schema metadata, not PII.
  // Long retention supports audits (compliance can ask when a tenant defined,
  // changed, or deleted the field).
  //
  // The 10-year keepFor is a conservative default; tenants can override it
  // through tenantRetentionOverride for their own edge cases
  // (e.g. shorter retention for test tenants).
  retention: {
    keepFor: "10y",
    strategy: "softDelete",
  },
  fields: {
    // The entity name for which this field is defined (e.g. "property",
    // "customer"). The 64-character maximum follows Kumiko's entity-name
    // convention.
    entityName: createTextField({
      required: true,
      maxLength: 64,
      personal: false,
      reason: "technical_reference",
    }),

    // Field key (e.g. "internalNumber", "vipFlag") — kebab-case and camelCase
    // are allowed; UI rendering uses label instead of fieldKey.
    fieldKey: createTextField({
      required: true,
      maxLength: 64,
      personal: false,
      reason: "technical_reference",
    }),

    // Field type from the SUPPORTED_FIELD_TYPES set. Validated with Zod in the
    // write handler.
    type: createTextField({
      required: true,
      maxLength: 16,
      personal: false,
      reason: "technical_reference",
    }),

    // Required flag — checked against the value during entity writes
    // (the same semantics as a base field).
    required: createBooleanField({ required: true }),

    // Searchable flag — when true, the field contributes to the search document
    // through the search-payload extension.
    searchable: createBooleanField({ required: true }),

    // UI display order, allowing tenants to sort their fields in the UI.
    displayOrder: createNumberField({ required: true, integer: true }),

    // Builder reuse: serialized r.field.X(opts) output stored as jsonb.
    // It includes type options (enum values, money currency, embedded schema),
    // defaultValue, fieldAccess, and i18n labels. During write validation, the
    // handler dehydrates this back into an r.field.X() instance and uses its
    // .schema for value validation.
    serializedField: createTextField({
      required: true,
      maxLength: 65536,
      personal: false,
      reason: "technical_reference",
    }),
  },
});
