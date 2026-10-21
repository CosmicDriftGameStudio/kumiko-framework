import { type DbRunner, extractTableName } from "@cosmicdrift/kumiko-framework/db";
import {
  createJsonbField,
  type FeatureRegistrar,
  isSystemTenant,
  type JsonbFieldDef,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import type { StoredEvent } from "@cosmicdrift/kumiko-framework/event-store";
import {
  clearCustomFieldKey,
  removeCustomFieldKeyForTenant,
  removeCustomFieldKeyFromAllTenants,
  setCustomFieldValue,
} from "./db/queries/projection.ts";
import type { CustomFieldClearedPayload, CustomFieldSetPayload } from "./events.ts";
import { createCustomFieldsFeature } from "./feature.ts";
import { CUSTOM_FIELDS_EXTENSION, FIELD_DEFINITION_AGGREGATE_TYPE } from "./web/constants.ts";

// Adds a `customFields jsonb` column to an entity definition.
//
//   const propertyEntity = createEntity({
//     fields: {
//       name: createTextField({ required: true }),
//       customFields: customFieldsField(),
//     },
//   });
//
// `customFields` follows the same contract as regular fields: default `{}` and
// NOT NULL, like embedded columns.
// @wrapper-known semantic-alias
export function customFieldsField(): JsonbFieldDef {
  return createJsonbField();
}

// Complete integration of the custom-fields bundle for a specific host
// entity. One call site per consumer registers all wiring aspects:
// extension tracking, the value-projection MSP, rebuild replay via
// extendEntityProjection, the postQuery hook for API flattening, and the
// search-payload extension for indexable customFields.
//
// Consumer-side:
//
//   defineFeature("property-mgmt", (r) => {
//     r.entity({ name: "property", ...propertyEntity });  // must have customFieldsField()
//     r.requires({ features: [CUSTOM_FIELDS_FEATURE_NAME] });
//     wireCustomFieldsFor(r, "property", propertyTable);
//   });
//
// The `entityTable` parameter is the Drizzle table instance (typically the
// output of `buildEntityTable(name, entity)`). Closing over `entityTable`
// avoids a runtime table lookup through the registry in the MSP apply
// function.
//
// **What is registered**:
//
//   1. r.useExtension("customFields", entityName) — opt-in marker enabling
//      boot validation and usage tracking through the registry.
//
//   2. r.multiStreamProjection — consumes customField.set/.cleared events
//      emitted by the customer's set-custom-field / clear-custom-field write
//      handlers. Updates entityTable.customFields jsonb through
//      jsonb_set / jsonb-key-removal.
//
//   3. r.extendEntityProjection — adds the same apply handlers to the host
//      entity's implicit projection so rebuildProjection replays the
//      customField events. Without this, customFields would reset to `{}` on
//      every entity rebuild (for example, after a schema migration).
//
//   4. r.entityHook("postQuery", entity, flatten-fn) — on every read of
//      this entity, expands `row.customFields` jsonb at the root level so
//      the API response looks like it contains regular fields.
//
//   5. r.searchPayloadExtension(entity, contributor) — contributes
//      searchable customFields keys as flat fields in the Meilisearch index
//      document.
//
//   6. fieldDefinition.deleted event handler in the same MSP — removes
//      orphaned values from all entity rows when a fieldDefinition is deleted
//      (one key removal per fieldKey).
export function wireCustomFieldsFor<TReg extends FeatureRegistrar<string>>(
  r: TReg,
  entityName: string,
  entityTable: unknown,
): void {
  // biome-ignore lint/correctness/useHookAtTopLevel: r.useExtension is a registrar-API method, not a React hook — false positive on the "use"-prefix heuristic.
  r.useExtension(CUSTOM_FIELDS_EXTENSION, entityName);

  // Qualified event-type-names — sourced from typed EventDef.name handles
  // (compile-time literal-typed, no Template-Literal-Drift from the toKebab-
  // collapse bug that exposed it).
  const setEventType = createCustomFieldsFeature().exports.setEvent.name;
  const clearedEventType = createCustomFieldsFeature().exports.clearedEvent.name;
  const fieldDefDeletedType = createCustomFieldsFeature().exports.fieldDefinitionDeletedEvent.name;

  // Shared apply bodies: the MSP supplies them live through an async cursor,
  // while the entity-projection extension replays them in rebuildProjection.
  // Both use the same idempotent SQL helpers. The two-parameter signature is
  // the common subset of MultiStreamApplyFn and SingleStreamApplyFn.
  const applyCustomFieldSet = async (event: StoredEvent, tx: DbRunner): Promise<void> => {
    // skip: fires for every aggregate type that emits customField.set, but only
    // events for the wired host entity should be processed. Other consumers
    // have their own wiring for their entities.
    if (event.aggregateType !== entityName) return;
    const payload = event.payload as CustomFieldSetPayload; // @cast-boundary engine-payload

    // skip: a value-less customField.set is an anomaly (every set
    // carries its value; the sensitive self-projection path was removed) —
    // warn and leave the row untouched instead of binding undefined.
    if (payload.value === undefined) {
      // biome-ignore lint/suspicious/noConsole: boot-adjacent correctness canary, no logger available in an apply function
      console.warn(
        `[custom-fields] customField.set for "${payload.fieldKey}" on ${event.aggregateType}/${event.aggregateId} has no value — skipping (value-less sets should not exist since #972).`,
      );
      // skip: warned above — leave the row untouched instead of binding undefined
      return;
    }

    // jsonb_set: assigns value to the key. If the key does not yet exist, it is
    // created (`create_missing=true` is the default). value must be supplied
    // as a jsonb literal.
    const tableName = extractTableName(entityTable, "custom-fields/wire-for-entity");
    await setCustomFieldValue(
      tx,
      tableName,
      payload.fieldKey,
      payload.value,
      event.aggregateId,
      event.tenantId,
    );
  };

  const applyCustomFieldCleared = async (event: StoredEvent, tx: DbRunner): Promise<void> => {
    // skip: fires for all aggregate types; process only our host entity.
    if (event.aggregateType !== entityName) return;
    const payload = event.payload as CustomFieldClearedPayload; // @cast-boundary engine-payload

    // The jsonb minus operator (`-`) removes a key from a jsonb object.
    const tableName = extractTableName(entityTable, "custom-fields/wire-for-entity");
    await clearCustomFieldKey(tx, tableName, payload.fieldKey, event.aggregateId, event.tenantId);
  };

  const applyFieldDefinitionDeleted = async (event: StoredEvent, tx: DbRunner): Promise<void> => {
    // fieldDefinition.deleted fires once per field-definition deletion, not once
    // per entity. Remove the key from all rows of the host entity if the
    // deleted field definition belonged to this entity.
    const payload = event.payload as {
      entityName: string;
      fieldKey: string;
      tenantId?: TenantId;
    }; // @cast-boundary engine-payload
    // skip: fieldDefinition.deleted fires for field definitions across all
    // entities; clean rows only when the deleted definition belonged to this
    // host entity.
    if (payload.entityName !== entityName) return;

    const tableName = extractTableName(entityTable, "custom-fields/wire-for-entity");
    // Scope cleanup to the deleted definition's owning tenant. System-scope
    // definitions apply to every tenant → cascade across all rows; tenant-
    // scope deletions must only touch that tenant's rows, else deleting one
    // tenant's field strips the same kebab key from every tenant (data loss).
    // Fallback to the event's stream tenantId for events appended before the
    // payload carried tenantId.
    const defTenantId = payload.tenantId ?? event.tenantId;
    if (isSystemTenant(defTenantId)) {
      await removeCustomFieldKeyFromAllTenants(tx, tableName, payload.fieldKey);
    } else {
      await removeCustomFieldKeyForTenant(tx, tableName, payload.fieldKey, defTenantId);
    }
  };

  r.multiStreamProjection({
    name: `custom-fields-${entityName}-projection`,
    apply: {
      [setEventType]: applyCustomFieldSet,
      [clearedEventType]: applyCustomFieldCleared,
      [fieldDefDeletedType]: applyFieldDefinitionDeleted,
    },
  });

  // Rebuild wiring: without it, rebuildProjection replays only entity
  // lifecycle events and resets each customFields jsonb value to its default
  // `{}`. The values exist only in customField.set/.cleared events. set/
  // cleared events use the HOST entity stream (aggregateType = entityName,
  // already covered by the source); fieldDefinition.deleted belongs to the
  // "field-definition" stream and is therefore added as an extra source.
  r.extendEntityProjection(entityName, {
    sources: [FIELD_DEFINITION_AGGREGATE_TYPE],
    apply: {
      [setEventType]: applyCustomFieldSet,
      [clearedEventType]: applyCustomFieldCleared,
      [fieldDefDeletedType]: applyFieldDefinitionDeleted,
    },
  });

  // postQuery hook: expands row.customFields jsonb at the API response's root
  // level so it is indistinguishable from regular fields.
  r.hook({
    type: "postQuery",
    target: { allOf: entityName },
    handler: async ({ rows }) => ({
      rows: rows.map((row) => {
        const customFields = row["customFields"];
        if (customFields && typeof customFields === "object" && !Array.isArray(customFields)) {
          return {
            ...(customFields as Record<string, unknown>), // @cast-boundary db-row jsonb runtime-untyped
            ...row, // base fields win: a custom fieldKey named `id`/`name` must not shadow the real column
          };
        }
        return row;
      }),
    }),
  });

  // Search-payload extension: flattens customFields keys into the index
  // document. Unlike the postQuery hook, which merges ALL keys, the search
  // contributor should include only fields defined with searchable=true. The
  // current version conservatively contributes everything; a later change
  // will filter by the fieldDefinition.searchable flag.
  r.searchPayloadExtension(entityName, ({ state }) => {
    const customFields = state["customFields"];
    if (customFields && typeof customFields === "object" && !Array.isArray(customFields)) {
      return customFields as Record<string, unknown>; // @cast-boundary db-row jsonb runtime-untyped
    }
    return {};
  });
}
