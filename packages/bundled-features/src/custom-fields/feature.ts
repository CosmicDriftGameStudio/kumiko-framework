// custom-fields — Tenant- + System-scoped Custom-Field-Definitions +
// generische Custom-Field-VALUE write-handler (host-stream-events).
//
// **Was diese Feature liefert (B1 + B2, 2026-05-23):**
//   1. r.entity("field-definition") — Definition-Storage (event-sourced).
//   2. define-tenant-field / define-system-field — RBAC write-handlers für
//      Definition-CRUD.
//   3. delete-tenant-field / delete-system-field — RBAC write-handlers.
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
  FIELD_DEFINITION_DELETED_EVENT,
} from "./constants";
import { fieldDefinitionEntity } from "./entity";
import { customFieldClearedSchema, customFieldSetSchema } from "./events";
import { clearCustomFieldHandler } from "./handlers/clear-custom-field.write";
import { defineSystemFieldHandler } from "./handlers/define-system-field.write";
import {
  createDefineTenantFieldHandler,
  defineTenantFieldHandler,
} from "./handlers/define-tenant-field.write";
import { deleteSystemFieldHandler } from "./handlers/delete-system-field.write";
import { deleteTenantFieldHandler } from "./handlers/delete-tenant-field.write";
import { setCustomFieldHandler } from "./handlers/set-custom-field.write";

const tenantAdminAccess = { access: { roles: ["TenantAdmin"] } } as const;

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

// Shared registration body for both the singleton and the quota-variant.
// Only the define-tenant-field handler differs (quota baked in or not); every
// other entity/event/handler is registered identically here so a new
// event/handler can never silently miss the quota variant.
function registerCustomFields(
  r: FeatureRegistrar<typeof CUSTOM_FIELDS_FEATURE_NAME>,
  defineTenantHandler: WriteHandlerDef,
) {
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

  // Definition-CRUD handlers (B1).
  r.writeHandler(defineTenantHandler);
  r.writeHandler(defineSystemFieldHandler);
  r.writeHandler(deleteTenantFieldHandler);
  r.writeHandler(deleteSystemFieldHandler);

  // Value-write handlers (B2). Emittieren events auf host-aggregate-stream.
  r.writeHandler(setCustomFieldHandler);
  r.writeHandler(clearCustomFieldHandler);

  // List-Query — tenant-scoped (B1-limit).
  r.queryHandler(
    defineEntityListHandler("field-definition", fieldDefinitionEntity, tenantAdminAccess),
  );

  return { setEvent, clearedEvent, fieldDefinitionDeletedEvent };
}

// Singleton feature-definition mit typed exports. Handler + wire-for-entity
// importieren diesen `customFieldsFeature` und greifen lazy in ihrer
// runtime-arrow-fn auf `.exports.<event>.name` zu — der module-cycle
// (feature.ts -> handlers/*.write.ts -> feature.ts) löst sich auf weil
// kein top-level-access stattfindet.
export const customFieldsFeature = defineFeature(CUSTOM_FIELDS_FEATURE_NAME, (r) =>
  registerCustomFields(r, defineTenantFieldHandler),
);

// Backwards-compat-wrapper. Bestehende Caller (z.B. integration-tests,
// host-apps) nutzen weiterhin `createCustomFieldsFeature()`. Returnt den
// module-level-Singleton — kein neuer build pro Aufruf, was für consumer
// nicht erkennbar ist (read-only inspection).
//
// **T1.5e options**: when `fieldDefinitionLimitPerTenant` is set, the
// returned feature carries a fresh `define-tenant-field` handler with the
// quota baked in. Callers that don't pass options get the singleton — no
// change in behavior.
export function createCustomFieldsFeature(
  opts: { readonly fieldDefinitionLimitPerTenant?: number } = {},
): typeof customFieldsFeature {
  if (opts.fieldDefinitionLimitPerTenant === undefined) {
    return customFieldsFeature;
  }
  const limit = opts.fieldDefinitionLimitPerTenant;
  return defineFeature(CUSTOM_FIELDS_FEATURE_NAME, (r) =>
    registerCustomFields(
      r,
      createDefineTenantFieldHandler({ fieldDefinitionLimitPerTenant: limit }),
    ),
  );
}
