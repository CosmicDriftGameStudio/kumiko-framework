// custom-fields — tenant- and system-scoped custom-field definitions plus
// generic custom-field value write-handlers (host-stream events).
//
// **Scope: supplemental business data, NO PII.** Custom fields are for
// tenant-specific additional data (reference numbers, flags, categories),
// not personally identifiable information. The former `sensitive` flag was
// removed; the schema rejects it and `parseSerializedField` throws for legacy
// definitions. Values are stored entirely in the event log (rebuild-safe).
// PII belongs in schema-entity fields with a `personal` annotation
// (crypto-shredding, event ciphertext, forget pipeline).
//
// **This feature provides:**
//   1. r.entity({ name: "field-definition" }) — event-sourced definition storage.
//   2. define-tenant-field / define-system-field — RBAC write-handlers for
//      definition CRUD.
//   3. delete-tenant-field / delete-system-field — RBAC write-handlers.
//   3b. update-tenant-field — full-replacement edit; type is immutable.
//   4. set-custom-field / clear-custom-field — write-handlers for VALUES.
//      They emit customField.set/.cleared events on the host aggregate stream.
//   5. r.defineEvent for customField.set/.cleared + fieldDefinition.deleted.
//   6. r.extendsRegistrar("customFields") — registers the extension name so
//      consumers can opt in via r.useExtension("customFields", "<entity>").
//   7. defineEntityListHandler — reads fieldDefinitions (currently tenant-
//      scoped; a system+tenant UNION requires a custom query).
//
// **Consumer-side wiring** (see wire-for-entity.ts):
//   The consumer calls `wireCustomFieldsFor(r, entityName, entityTable)`,
//   which registers per host entity: useExtension + MSP (JSONB projection)
//   + postQuery hook (flattening) + search-payload extension.
//
// **Host-entity requirement**:
//   The consumer MUST declare a `customFields` column as
//   `customFieldsField()` (JSONB) in the entity definition.
//
// **Exports pattern**:
//   `createCustomFieldsFeature().exports.{setEvent,clearedEvent,fieldDefinitionDeletedEvent}`
//   provides typed EventDef handles. Handlers and wire-for-entity use
//   `<event>.name` as a compile-time literal-typed qualified string instead of
//   hand-built template literals, which drifted from the real names once
//   toKebab collapsed them.
//
// **Still open:**
//   - Cross-scope conflict detection (a tenant overriding a system fieldKey)
//   - Cross-scope read UNION (system + tenant fieldDefinitions in one list)
//   (cap-counter quota, user-data-rights anonymization, and value validation
//   against serializedField via fieldToZod in set-custom-field are complete.)

import {
  defineEntityListHandler,
  defineFeature,
  type FeatureRegistrar,
  type WriteHandlerDef,
} from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { fieldDefinitionEntity } from "./entity.ts";
import { customFieldClearedSchema, customFieldSetSchema } from "./events.ts";
import {
  clearCustomFieldHandler,
  createClearCustomFieldHandler,
} from "./handlers/clear-custom-field.write.ts";
import { defineSystemFieldHandler } from "./handlers/define-system-field.write.ts";
import {
  createDefineTenantFieldHandler,
  defineTenantFieldHandler,
} from "./handlers/define-tenant-field.write.ts";
import { deleteSystemFieldHandler } from "./handlers/delete-system-field.write.ts";
import {
  createDeleteTenantFieldHandler,
  deleteTenantFieldHandler,
} from "./handlers/delete-tenant-field.write.ts";
import {
  createSetCustomFieldHandler,
  setCustomFieldHandler,
} from "./handlers/set-custom-field.write.ts";
import {
  createUpdateTenantFieldHandler,
  updateTenantFieldHandler,
} from "./handlers/update-tenant-field.write.ts";
import {
  CUSTOM_FIELD_CLEARED_EVENT,
  CUSTOM_FIELD_SET_EVENT,
  CUSTOM_FIELDS_EXTENSION,
  CUSTOM_FIELDS_FEATURE_NAME,
  DEFAULT_FIELD_DEFINITION_LIST_ROLES,
  FIELD_DEFINITION_DELETED_EVENT,
} from "./web/constants.ts";

const fieldDefinitionDeletedSchema = z.object({
  entityName: z.string(),
  fieldKey: z.string(),
  // Owning tenant of the deleted definition: a specific tenant for tenant-scope
  // deletions, SYSTEM_TENANT_ID for system-scope. The cascade-MSP scopes its
  // orphan-cleanup by this so a tenant deletion never touches other tenants'
  // rows. Optional for backward-compat with events appended before this field
  // existed — the MSP falls back to the event's stream tenantId.
  tenantId: z.string().optional(),
});

// Handler and access variants can differ between the singleton and options
// variant. Everything else registers identically through registerCustomFields
// so a new event or handler cannot silently be omitted from the options variant.
type RegisterVariant = {
  readonly defineTenantHandler: WriteHandlerDef;
  readonly updateTenantHandler: WriteHandlerDef;
  readonly deleteTenantHandler: WriteHandlerDef;
  readonly setHandler: WriteHandlerDef;
  readonly clearHandler: WriteHandlerDef;
  readonly fieldDefinitionListRoles: readonly string[];
};

// Shared registration body for both the singleton and the options-variant.
function registerCustomFields(
  r: FeatureRegistrar<typeof CUSTOM_FIELDS_FEATURE_NAME>,
  variant: RegisterVariant,
) {
  r.describe(
    "Tenant- and system-scoped custom field definitions with generic value storage on any host entity. Registers the `field-definition` entity (event-sourced CRUD via `define-tenant-field`, `define-system-field`, `update-tenant-field`, `delete-tenant-field`, `delete-system-field`) and two value write-handlers (`set-custom-field`, `clear-custom-field`) that emit `custom-fields:event:custom-field-set` / `custom-fields:event:custom-field-cleared` events on the host aggregate's stream. To attach custom fields to your own entity, call `wireCustomFieldsFor(r, entityName, entityTable)` in the host feature — this wires the JSONB projection, `postQuery` flattening hook, and search-payload extension. The host entity must declare a `customFieldsField()` JSONB column.",
  );
  r.uiHints({
    displayLabel: "Custom Fields",
    category: "data",
    recommended: false,
  });
  r.entity({ name: "field-definition", ...fieldDefinitionEntity });

  // Event types — qualified as "custom-fields:event:<short-name>".
  // Returned EventDefs expose .name as a compile-time literal-typed string,
  // which handlers and MSP keys consume instead of constructing template literals.
  // `value: z.unknown()` has no field-level schema to catalog under piiFields
  // (event PII covers string fields only), so "no PII" is a convention here,
  // not an enforced guarantee.
  const setEvent = r.defineEvent(CUSTOM_FIELD_SET_EVENT, customFieldSetSchema, {
    piiFields: "none",
  });
  const clearedEvent = r.defineEvent(CUSTOM_FIELD_CLEARED_EVENT, customFieldClearedSchema, {
    piiFields: "none",
  });
  const fieldDefinitionDeletedEvent = r.defineEvent(
    FIELD_DEFINITION_DELETED_EVENT,
    fieldDefinitionDeletedSchema,
    { piiFields: "none" },
  );

  // Registers that this extension exists.
  // Consumer-side: r.useExtension("customFields", "<entity>") marks opt-in,
  // but does not wire anything automatically. The consumer MUST also call
  // `wireCustomFieldsFor(r, entity, table)` to register the MSP, postQuery hook,
  // and search extension.
  // The empty-options pattern (`{}`) is intentional: boot-time onRegister
  // wiring would require a closure over the Drizzle table, which the consumer
  // does not provide during extendsRegistrar registration. Explicit consumer-
  // side wiring therefore avoids implicit magic.
  r.extendsRegistrar(CUSTOM_FIELDS_EXTENSION, {});

  // Definition CRUD handlers.
  r.writeHandler(variant.defineTenantHandler);
  r.writeHandler(defineSystemFieldHandler);
  r.writeHandler(variant.updateTenantHandler);
  r.writeHandler(variant.deleteTenantHandler);
  r.writeHandler(deleteSystemFieldHandler);

  // Value write handlers. They emit events on the host aggregate stream.
  r.writeHandler(variant.setHandler);
  r.writeHandler(variant.clearHandler);

  // The list query is tenant-scoped. CustomFieldsFormSection dispatches this
  // query name directly, so apps with their own role vocabulary must override
  // the roles through fieldDefinitionListRoles.
  r.queryHandler(
    defineEntityListHandler("field-definition", fieldDefinitionEntity, {
      access: { roles: variant.fieldDefinitionListRoles },
      description:
        "Lists the custom-field definitions of the caller's own tenant; use it to discover which extra fields an entity accepts before setting or clearing a value on it.",
    }),
  );

  return { setEvent, clearedEvent, fieldDefinitionDeletedEvent };
}

// Handlers and wire-for-entity read `.exports.<event>.name` lazily inside their runtime
// arrow functions, which resolves the module cycle (feature.ts -> handlers/*.write.ts -> feature.ts).
const defaultCustomFieldsFeature = defineFeature(CUSTOM_FIELDS_FEATURE_NAME, (r) =>
  registerCustomFields(r, {
    defineTenantHandler: defineTenantFieldHandler,
    updateTenantHandler: updateTenantFieldHandler,
    deleteTenantHandler: deleteTenantFieldHandler,
    setHandler: setCustomFieldHandler,
    clearHandler: clearCustomFieldHandler,
    fieldDefinitionListRoles: DEFAULT_FIELD_DEFINITION_LIST_ROLES,
  }),
);

export type CustomFieldsFeatureOptions = {
  /** Quota for define-tenant-field. */
  readonly fieldDefinitionLimitPerTenant?: number;
  /** Roles for set-/clear-custom-field, used by the save paths in
   * CustomFieldsFormSection. Default ["TenantAdmin","TenantMember"];
   * apps with their own role vocabulary (for example ["Admin","Editor"])
   * MUST set this, otherwise value saving is access_denied for every app user
   * (role-naming drift). */
  readonly valueWriteRoles?: readonly string[];
  /** Roles for custom-fields:query:field-definition:list, used by the loading
   * path in CustomFieldsFormSection. Default ["TenantAdmin"]. If
   * valueWriteRoles is set but this is not, the value roles are inherited here
   * (unioned with the default so admins retain list access); otherwise the
   * FormSection cannot load for value writers (access_denied) while the save
   * path remains open (an asymmetric break). */
  readonly fieldDefinitionListRoles?: readonly string[];
  /** Access roles for the definition-CRUD triad (`define-tenant-field`,
   *  `update-tenant-field`, `delete-tenant-field`) — hard-wired to ["TenantAdmin"].
   *  Apps with their own role vocabulary (e.g. ["Admin","Editor"])
   *  MUST set this, else field-definition management is access_denied for every
   *  app-user without a "TenantAdmin" role. Only covers the tenant-scope triad —
   *  define-/delete-system-field stay hard-wired to ["SystemAdmin"], since
   *  system-scope is a separate trust boundary that must not become reachable
   *  through a tenant role vocabulary. Also feeds into
   *  resolveFieldDefinitionListRoles (below) so a definer without an explicit
   *  fieldDefinitionListRoles override can still load the definitions they can
   *  write — mirrors the valueWriteRoles → list-default inheritance. */
  readonly fieldDefinitionWriteRoles?: readonly string[];
};

export function resolveFieldDefinitionListRoles(
  opts: Pick<
    CustomFieldsFeatureOptions,
    "valueWriteRoles" | "fieldDefinitionListRoles" | "fieldDefinitionWriteRoles"
  >,
): readonly string[] {
  if (opts.fieldDefinitionListRoles !== undefined) return opts.fieldDefinitionListRoles;
  if (opts.valueWriteRoles === undefined && opts.fieldDefinitionWriteRoles === undefined) {
    return DEFAULT_FIELD_DEFINITION_LIST_ROLES;
  }
  // The default stays in the union: with valueWriteRoles unset, TenantAdmin still
  // saves values and must be able to load the FormSection.
  return [
    ...new Set([
      ...(opts.valueWriteRoles ?? []),
      ...(opts.fieldDefinitionWriteRoles ?? []),
      ...DEFAULT_FIELD_DEFINITION_LIST_ROLES,
    ]),
  ];
}

// Without options this returns the module-level singleton (no rebuild per call); every
// option builds a fresh feature definition with the variant handlers.
export function createCustomFieldsFeature(
  opts: CustomFieldsFeatureOptions = {},
): typeof defaultCustomFieldsFeature {
  const hasOptions =
    opts.fieldDefinitionLimitPerTenant !== undefined ||
    opts.valueWriteRoles !== undefined ||
    opts.fieldDefinitionListRoles !== undefined ||
    opts.fieldDefinitionWriteRoles !== undefined;
  if (!hasOptions) {
    return defaultCustomFieldsFeature;
  }
  const limit = opts.fieldDefinitionLimitPerTenant;
  const definitionWriteRoles = opts.fieldDefinitionWriteRoles;
  return defineFeature(CUSTOM_FIELDS_FEATURE_NAME, (r) =>
    registerCustomFields(r, {
      defineTenantHandler:
        limit !== undefined || definitionWriteRoles !== undefined
          ? createDefineTenantFieldHandler({
              fieldDefinitionLimitPerTenant: limit,
              roles: definitionWriteRoles,
            })
          : defineTenantFieldHandler,
      updateTenantHandler:
        definitionWriteRoles !== undefined
          ? createUpdateTenantFieldHandler({ roles: definitionWriteRoles })
          : updateTenantFieldHandler,
      deleteTenantHandler:
        definitionWriteRoles !== undefined
          ? createDeleteTenantFieldHandler({ roles: definitionWriteRoles })
          : deleteTenantFieldHandler,
      setHandler: createSetCustomFieldHandler(opts.valueWriteRoles),
      clearHandler: createClearCustomFieldHandler(opts.valueWriteRoles),
      fieldDefinitionListRoles: resolveFieldDefinitionListRoles(opts),
    }),
  );
}
