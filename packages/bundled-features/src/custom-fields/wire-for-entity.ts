import { extractTableName } from "@cosmicdrift/kumiko-framework/db";
import {
  createJsonbField,
  type FeatureRegistrar,
  type JsonbFieldDef,
} from "@cosmicdrift/kumiko-framework/engine";
import { isPlainObject } from "@cosmicdrift/kumiko-framework/utils";
import { fieldDefinitionDeletedSchema } from "./events.ts";
import { createCustomFieldsFeature } from "./feature.ts";
import {
  indexableCustomFields,
  loadEntityFieldDefinitions,
  readableCustomFields,
} from "./lib/field-read-access.ts";
import {
  applyCustomFieldCleared,
  applyCustomFieldSet,
  applyFieldDefinitionDeleted,
} from "./lib/host-value-apply.ts";
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
export function customFieldsField(): JsonbFieldDef {
  return createJsonbField();
}

// Complete integration of the custom-fields bundle for a specific host
// entity. One call site per consumer registers all wiring aspects:
// extension tracking, rebuild replay via extendEntityProjection, the
// postQuery hook for API flattening, and the search-payload extension for
// indexable customFields.
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
// output of `buildEntityTable(name, entity)`). It serves the rebuild
// replay of the entity projection.
//
// **What is registered**:
//
//   1. r.applyExtension({ name: "customFields", entity: entityName }) — opt-in marker enabling
//      boot validation and usage tracking through the registry.
//
//   2. The values are written by the one MSP `custom-fields:projection:host-values`
//      of the custom-fields feature, which finds the host table through the
//      registry. wireCustomFieldsFor makes the host visible to it via
//      applyExtension.
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
//   6. fieldDefinition.deleted is processed by the same `host-values` MSP —
//      removes orphaned values from all entity rows when a fieldDefinition is
//      deleted (one key removal per fieldKey).
export function wireCustomFieldsFor<TReg extends FeatureRegistrar<string>>(
  r: TReg,
  entityName: string,
  entityTable: unknown,
): void {
  r.applyExtension({ name: CUSTOM_FIELDS_EXTENSION, entity: entityName });

  const { setEvent, clearedEvent, fieldDefinitionDeletedEvent } =
    createCustomFieldsFeature().exports;
  const tableName = extractTableName(entityTable, "custom-fields/wire-for-entity");

  // Rebuild wiring: without it, rebuildProjection replays only entity
  // lifecycle events and resets each customFields jsonb value to its default
  // `{}`. The values exist only in customField.set/.cleared events. set/
  // cleared events use the HOST entity stream (aggregateType = entityName,
  // already covered by the source); fieldDefinition.deleted belongs to the
  // "field-definition" stream and is therefore added as an extra source.
  r.extendEntityProjection(entityName, {
    sources: [FIELD_DEFINITION_AGGREGATE_TYPE],
    apply: {
      [setEvent.name]: (event, tx) => applyCustomFieldSet(event, tx, tableName),
      [clearedEvent.name]: (event, tx) => applyCustomFieldCleared(event, tx, tableName),
      [fieldDefinitionDeletedEvent.name]: async (event, tx) => {
        const payload = fieldDefinitionDeletedSchema.parse(event.payload);
        // skip: the definition belonged to another host entity
        if (payload.entityName !== entityName) return;
        await applyFieldDefinitionDeleted(payload, tx, tableName);
      },
    },
  });

  // postQuery hook: expands the readable part of row.customFields at the API
  // response's root level so it is indistinguishable from regular fields.
  r.hook({
    type: "postQuery",
    target: { allOf: entityName },
    handler: async ({ rows }, ctx) => {
      const hasCustomFields = rows.some((row) => {
        const customFields = row["customFields"];
        return isPlainObject(customFields) && Object.keys(customFields).length > 0;
      });
      if (!hasCustomFields) return { rows };
      const definitions = await loadEntityFieldDefinitions(ctx.db, entityName);
      return {
        rows: rows.map((row) => {
          const customFields = row["customFields"];
          if (!isPlainObject(customFields)) return row;
          const readable = readableCustomFields(customFields, definitions, ctx.user.roles);
          // base fields win: a custom fieldKey named `id`/`name` must not shadow the real column
          return { ...readable, ...row, customFields: readable };
        }),
      };
    },
  });

  // Only searchable fields without a read restriction reach the index.
  r.searchPayloadExtension(entityName, async ({ state, db }) => {
    const customFields = state["customFields"];
    if (!isPlainObject(customFields) || Object.keys(customFields).length === 0) return {};
    return indexableCustomFields(customFields, await loadEntityFieldDefinitions(db, entityName));
  });
}
