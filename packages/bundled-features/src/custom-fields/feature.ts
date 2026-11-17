// custom-fields: tenant- and system-scoped field definitions plus value write-handlers.
// Values are supplemental business data and contain NO PII; PII belongs in entity
// fields with a `personal` annotation.
// The consumer must call `wireCustomFieldsFor(r, entityName, entityTable)` and declare a
// `customFieldsField()` column on the host entity.

import {
  defineEntityListHandler,
  defineFeature,
  type FeatureRegistrar,
} from "@cosmicdrift/kumiko-framework/engine";
import { fieldDefinitionEntity } from "./entity.ts";
import {
  addTenantIdToFieldDefinitionDeleted,
  customFieldClearedSchema,
  customFieldSetSchema,
  FIELD_DEFINITION_DELETED_EVENT_VERSION,
  fieldDefinitionDeletedSchema,
} from "./events.ts";
import { createClearCustomFieldHandler } from "./handlers/clear-custom-field.write.ts";
import { defineSystemFieldHandler } from "./handlers/define-system-field.write.ts";
import { createDefineTenantFieldHandler } from "./handlers/define-tenant-field.write.ts";
import { deleteSystemFieldHandler } from "./handlers/delete-system-field.write.ts";
import { createDeleteTenantFieldHandler } from "./handlers/delete-tenant-field.write.ts";
import { createSetCustomFieldHandler } from "./handlers/set-custom-field.write.ts";
import { createUpdateTenantFieldHandler } from "./handlers/update-tenant-field.write.ts";
import { CUSTOM_FIELDS_I18N } from "./i18n.ts";
import { customFieldsHostTableName } from "./lib/custom-fields-host.ts";
import {
  applyCustomFieldCleared,
  applyCustomFieldSet,
  applyFieldDefinitionDeleted,
} from "./lib/host-value-apply.ts";
import {
  CUSTOM_FIELD_CLEARED_EVENT,
  CUSTOM_FIELD_SET_EVENT,
  CUSTOM_FIELDS_EXTENSION,
  CUSTOM_FIELDS_FEATURE_NAME,
  DEFAULT_FIELD_DEFINITION_LIST_ROLES,
  FIELD_DEFINITION_DELETED_EVENT,
} from "./web/constants.ts";

// Shared registration body for both the singleton and the options-variant, so a new
// event or handler cannot silently be omitted from the options variant.
function registerCustomFields(
  r: FeatureRegistrar<typeof CUSTOM_FIELDS_FEATURE_NAME>,
  opts: CustomFieldsFeatureOptions,
) {
  r.describe(
    "Tenant- and system-scoped custom field definitions with generic value storage on any host entity. Registers the `field-definition` entity (event-sourced CRUD via `define-tenant-field`, `define-system-field`, `update-tenant-field`, `delete-tenant-field`, `delete-system-field`) and two value write-handlers (`set-custom-field`, `clear-custom-field`) that emit `custom-fields:event:custom-field-set` / `custom-fields:event:custom-field-cleared` events on the host aggregate's stream. To attach custom fields to your own entity, call `wireCustomFieldsFor(r, entityName, entityTable)` in the host feature — this wires the JSONB projection, `postQuery` flattening hook, and search-payload extension. The host entity must declare a `customFieldsField()` JSONB column.",
  );
  r.uiHints({
    displayLabel: "Custom Fields",
    category: "data",
    recommended: false,
  });
  r.translations({ keys: CUSTOM_FIELDS_I18N });
  r.entity(fieldDefinitionEntity);

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
    {
      piiFields: "none",
      version: FIELD_DEFINITION_DELETED_EVENT_VERSION,
      migrations: [
        {
          fromVersion: 1,
          toVersion: FIELD_DEFINITION_DELETED_EVENT_VERSION,
          transform: addTenantIdToFieldDefinitionDeleted,
        },
      ],
    },
  );

  // Registers that this extension exists.
  // This feature registers the one values projection `host-values` for all
  // hosts. `wireCustomFieldsFor(r, entity, table)` announces a host
  // (useExtension), provides the rebuild replay (extendEntityProjection) and
  // registers the postQuery hook and search extension.
  // The empty-options pattern (`{}`) is intentional: boot-time onRegister
  // wiring would require a closure over the Drizzle table, which the consumer
  // does not provide during extendsRegistrar registration. Explicit consumer-
  // side wiring therefore avoids implicit magic.
  r.extendsRegistrar(CUSTOM_FIELDS_EXTENSION, {});

  // Definition CRUD handlers.
  r.writeHandler(
    createDefineTenantFieldHandler({
      fieldDefinitionLimitPerTenant: opts.fieldDefinitionLimitPerTenant,
      roles: opts.fieldDefinitionWriteRoles,
    }),
  );
  r.writeHandler(defineSystemFieldHandler);
  r.writeHandler(createUpdateTenantFieldHandler({ roles: opts.fieldDefinitionWriteRoles }));
  r.writeHandler(createDeleteTenantFieldHandler({ roles: opts.fieldDefinitionWriteRoles }));
  r.writeHandler(deleteSystemFieldHandler);

  // Value write handlers. They emit events on the host aggregate stream.
  r.writeHandler(createSetCustomFieldHandler(opts.valueWriteRoles));
  r.writeHandler(createClearCustomFieldHandler(opts.valueWriteRoles));

  // The list query is tenant-scoped. CustomFieldsFormSection dispatches this
  // query name directly, so apps with their own role vocabulary must override
  // the roles through fieldDefinitionListRoles.
  r.queryHandler(
    defineEntityListHandler("field-definition", fieldDefinitionEntity, {
      access: { roles: resolveFieldDefinitionListRoles(opts) },
      description:
        "Lists the custom-field definitions of the caller's own tenant; use it to discover which extra fields an entity accepts before setting or clearing a value on it.",
    }),
  );

  r.multiStreamProjection({
    name: "host-values",
    apply: {
      [setEvent.name]: async (event, tx, ctx) => {
        const tableName = customFieldsHostTableName(ctx.registry, event.aggregateType);
        // skip: value events only exist on wired hosts (set-custom-field checks); an unwired type has no table
        if (tableName === undefined) return;
        await applyCustomFieldSet(event, tx, tableName);
      },
      [clearedEvent.name]: async (event, tx, ctx) => {
        const tableName = customFieldsHostTableName(ctx.registry, event.aggregateType);
        // skip: see set
        if (tableName === undefined) return;
        await applyCustomFieldCleared(event, tx, tableName);
      },
      [fieldDefinitionDeletedEvent.name]: async (event, tx, ctx) => {
        const payload = fieldDefinitionDeletedSchema.parse(event.payload);
        const tableName = customFieldsHostTableName(ctx.registry, payload.entityName);
        // skip: the deleted definition belonged to an entity that is not wired here
        if (tableName === undefined) return;
        await applyFieldDefinitionDeleted(payload, tx, tableName);
      },
    },
  });

  return { setEvent, clearedEvent, fieldDefinitionDeletedEvent };
}

// Handlers and wire-for-entity read `.exports.<event>.name` lazily inside their runtime
// arrow functions, which resolves the module cycle (feature.ts -> handlers/*.write.ts -> feature.ts).
const defaultCustomFieldsFeature = defineFeature(CUSTOM_FIELDS_FEATURE_NAME, (r) =>
  registerCustomFields(r, {}),
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
  return defineFeature(CUSTOM_FIELDS_FEATURE_NAME, (r) => registerCustomFields(r, opts));
}
