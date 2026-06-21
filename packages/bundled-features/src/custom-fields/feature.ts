// custom-fields — Tenant- + System-scoped Custom-Field-Definitions +
// generische Custom-Field-VALUE write-handler (host-stream-events).
//
// **Was diese Feature liefert (B1 + B2, 2026-05-23):**
//   1. r.entity("field-definition") — Definition-Storage (event-sourced).
//   2. define-tenant-field / define-system-field — RBAC write-handlers für
//      Definition-CRUD.
//   3. delete-tenant-field / delete-system-field — RBAC write-handlers.
//   3b. update-tenant-field — Vollersatz-Edit (Bug-Bash D2); type immutable.
//   4. set-custom-field / clear-custom-field — write-handlers für VALUES.
//      Emittieren customField.set/.cleared-Events auf host-aggregate-stream.
//   5. r.defineEvent für customField.set/.cleared + fieldDefinition.deleted.
//   6. r.extendsRegistrar("customFields") — registriert die extension-name
//      damit consumer via r.useExtension("customFields", "<entity>") opt-in.
//   7. defineEntityListHandler — read fieldDefinitions (B1-limit: nur tenant-
//      scope; B2-todo: system+tenant UNION als custom query).
//
// **Consumer-side-Wiring** (siehe wire-for-entity.ts):
//   Consumer ruft `wireCustomFieldsFor(r, entityName, entityTable)` auf —
//   das registriert pro host-entity: useExtension + MSP (jsonb-projection)
//   + postQuery-hook (flatten) + search-payload-extension.
//
// **Host-Entity-Requirement**:
//   Consumer MUSS in der entity-definition eine `customFields`-Spalte als
//   `customFieldsField()` (jsonb) deklarieren.
//
// **Exports-Pattern (2026-05-23 refactor)**:
//   `customFieldsFeature.exports.{setEvent,clearedEvent,fieldDefinitionDeletedEvent}`
//   liefern typed EventDef-handles. Handler + wire-for-entity nutzen
//   `<event>.name` als compile-time-literal-typed qualified-string — keine
//   hand-gebauten Template-Literals mehr (T1 hat den toKebab-collapse-drift
//   aufgedeckt, siehe Memory feedback_event_def_exports_pattern).
//
// **Noch offen (future iterations)**:
//   - Cross-scope-conflict-Detection (Tenant überschreibt system fieldKey)
//   - Cross-Scope-Read-UNION (system + tenant fieldDefinitions in einem List)
//   (cap-counter-quota → T1.5e, user-data-rights-anonymization → T1.5c,
//    Value-Validation gegen serializedField → set-custom-field via fieldToZod —
//    alle erledigt.)

import {
  defineEntityListHandler,
  defineFeature,
  type FeatureRegistrar,
  type WriteHandlerDef,
} from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import {
  CUSTOM_FIELD_CLEARED_EVENT,
  CUSTOM_FIELD_SET_EVENT,
  CUSTOM_FIELDS_EXTENSION,
  CUSTOM_FIELDS_FEATURE_NAME,
  DEFAULT_FIELD_DEFINITION_LIST_ROLES,
  FIELD_DEFINITION_DELETED_EVENT,
} from "./constants";
import { fieldDefinitionEntity } from "./entity";
import { customFieldClearedSchema, customFieldSetSchema } from "./events";
import {
  clearCustomFieldHandler,
  createClearCustomFieldHandler,
} from "./handlers/clear-custom-field.write";
import { defineSystemFieldHandler } from "./handlers/define-system-field.write";
import {
  createDefineTenantFieldHandler,
  defineTenantFieldHandler,
} from "./handlers/define-tenant-field.write";
import { deleteSystemFieldHandler } from "./handlers/delete-system-field.write";
import { deleteTenantFieldHandler } from "./handlers/delete-tenant-field.write";
import {
  createSetCustomFieldHandler,
  setCustomFieldHandler,
} from "./handlers/set-custom-field.write";
import { updateTenantFieldHandler } from "./handlers/update-tenant-field.write";

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

// Handler-/Access-Varianten die zwischen Singleton und Options-Variante
// differieren können. Alles andere registriert registerCustomFields für
// beide identisch, damit ein neues Event/Handler nie still die
// Options-Variante verfehlt.
type RegisterVariant = {
  readonly defineTenantHandler: WriteHandlerDef;
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
  r.entity("field-definition", fieldDefinitionEntity);

  // Event-types — qualified als "custom-fields:event:<short-name>".
  // Returned EventDefs liefern .name als compile-time literal-typed string,
  // den Handler + MSP-keys konsumieren statt Template-Literal-Konstruktion.
  const setEvent = r.defineEvent(CUSTOM_FIELD_SET_EVENT, customFieldSetSchema);
  const clearedEvent = r.defineEvent(CUSTOM_FIELD_CLEARED_EVENT, customFieldClearedSchema);
  const fieldDefinitionDeletedEvent = r.defineEvent(
    FIELD_DEFINITION_DELETED_EVENT,
    fieldDefinitionDeletedSchema,
  );

  // Extension-Registrar — registriert dass diese Extension existiert.
  // Consumer-side: r.useExtension("customFields", "<entity>") MARKIERT
  // opt-in, aber wired NICHTS automatisch. Consumer MUSS zusätzlich
  // `wireCustomFieldsFor(r, entity, table)` aufrufen damit MSP +
  // postQuery-hook + search-extension tatsächlich registriert werden.
  // Empty-options-Pattern (`{}`) ist absichtlich — boot-time-onRegister-
  // wiring würde Closure über Drizzle-Table benötigen, die der Consumer
  // bei extendsRegistrar-Registration nicht kennt. Daher consumer-side
  // explicit-wiring statt magic-auto-wiring.
  r.extendsRegistrar(CUSTOM_FIELDS_EXTENSION, {});

  // Definition-CRUD handlers (B1; update kam mit Bug-Bash D2 2026-06-08).
  r.writeHandler(variant.defineTenantHandler);
  r.writeHandler(defineSystemFieldHandler);
  r.writeHandler(updateTenantFieldHandler);
  r.writeHandler(deleteTenantFieldHandler);
  r.writeHandler(deleteSystemFieldHandler);

  // Value-write handlers (B2). Emittieren events auf host-aggregate-stream.
  r.writeHandler(variant.setHandler);
  r.writeHandler(variant.clearHandler);

  // List-Query — tenant-scoped (B1-limit). Die CustomFieldsFormSection
  // dispatcht diesen QN hart — Apps mit eigenem Rollen-Vokabular
  // überschreiben die Rollen via fieldDefinitionListRoles.
  r.queryHandler(
    defineEntityListHandler("field-definition", fieldDefinitionEntity, {
      access: { roles: variant.fieldDefinitionListRoles },
    }),
  );

  return { setEvent, clearedEvent, fieldDefinitionDeletedEvent };
}

// Singleton feature-definition mit typed exports. Handler + wire-for-entity
// importieren diesen `customFieldsFeature` und greifen lazy in ihrer
// runtime-arrow-fn auf `.exports.<event>.name` zu — der module-cycle
// (feature.ts -> handlers/*.write.ts -> feature.ts) löst sich auf weil
// kein top-level-access stattfindet.
export const customFieldsFeature = defineFeature(CUSTOM_FIELDS_FEATURE_NAME, (r) =>
  registerCustomFields(r, {
    defineTenantHandler: defineTenantFieldHandler,
    setHandler: setCustomFieldHandler,
    clearHandler: clearCustomFieldHandler,
    fieldDefinitionListRoles: DEFAULT_FIELD_DEFINITION_LIST_ROLES,
  }),
);

export type CustomFieldsFeatureOptions = {
  /** T1.5e: Quota für define-tenant-field. */
  readonly fieldDefinitionLimitPerTenant?: number;
  /** Rollen für set-/clear-custom-field — die Save-Pfade der
   *  CustomFieldsFormSection. Default ["TenantAdmin","TenantMember"];
   *  Apps mit eigenem Rollen-Vokabular (z.B. ["Admin","Editor"]) MÜSSEN
   *  das setzen, sonst ist der Value-Save für jeden App-User
   *  access_denied (Role-Naming-Drift). */
  readonly valueWriteRoles?: readonly string[];
  /** Rollen für custom-fields:query:field-definition:list — der Lade-Pfad
   *  der CustomFieldsFormSection. Default ["TenantAdmin"]. Wird valueWriteRoles
   *  gesetzt, dies aber NICHT, erben die Value-Rollen hier hinein (Union mit
   *  dem Default, damit Admins den List-Zugriff behalten) — sonst lädt die
   *  FormSection für Value-Writer nie (access_denied), während der Save-Pfad
   *  offen wäre (asymmetrischer Bruch). */
  readonly fieldDefinitionListRoles?: readonly string[];
};

export function resolveFieldDefinitionListRoles(
  opts: Pick<CustomFieldsFeatureOptions, "valueWriteRoles" | "fieldDefinitionListRoles">,
): readonly string[] {
  if (opts.fieldDefinitionListRoles !== undefined) return opts.fieldDefinitionListRoles;
  if (opts.valueWriteRoles === undefined) return DEFAULT_FIELD_DEFINITION_LIST_ROLES;
  return [...new Set([...opts.valueWriteRoles, ...DEFAULT_FIELD_DEFINITION_LIST_ROLES])];
}

// Backwards-compat-wrapper. Bestehende Caller (z.B. integration-tests,
// host-apps) nutzen weiterhin `createCustomFieldsFeature()`. Returnt den
// module-level-Singleton — kein neuer build pro Aufruf, was für consumer
// nicht erkennbar ist (read-only inspection). Jede gesetzte Option baut
// eine frische Feature-Definition mit den Varianten-Handlern.
export function createCustomFieldsFeature(
  opts: CustomFieldsFeatureOptions = {},
): typeof customFieldsFeature {
  const hasOptions =
    opts.fieldDefinitionLimitPerTenant !== undefined ||
    opts.valueWriteRoles !== undefined ||
    opts.fieldDefinitionListRoles !== undefined;
  if (!hasOptions) {
    return customFieldsFeature;
  }
  const limit = opts.fieldDefinitionLimitPerTenant;
  return defineFeature(CUSTOM_FIELDS_FEATURE_NAME, (r) =>
    registerCustomFields(r, {
      defineTenantHandler:
        limit !== undefined
          ? createDefineTenantFieldHandler({ fieldDefinitionLimitPerTenant: limit })
          : defineTenantFieldHandler,
      setHandler: createSetCustomFieldHandler(opts.valueWriteRoles),
      clearHandler: createClearCustomFieldHandler(opts.valueWriteRoles),
      fieldDefinitionListRoles: resolveFieldDefinitionListRoles(opts),
    }),
  );
}
