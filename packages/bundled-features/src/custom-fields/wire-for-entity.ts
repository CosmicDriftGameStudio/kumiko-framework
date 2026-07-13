import { type DbRunner, extractTableName } from "@cosmicdrift/kumiko-framework/db";
import {
  createJsonbField,
  type FeatureRegistrar,
  isSystemTenant,
  type JsonbFieldDef,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import type { StoredEvent } from "@cosmicdrift/kumiko-framework/event-store";
import { CUSTOM_FIELDS_EXTENSION, FIELD_DEFINITION_AGGREGATE_TYPE } from "./constants";
import {
  clearCustomFieldKey,
  removeCustomFieldKeyForTenant,
  removeCustomFieldKeyFromAllTenants,
  setCustomFieldValue,
} from "./db/queries/projection";

import type { CustomFieldClearedPayload, CustomFieldSetPayload } from "./events";
import { customFieldsFeature } from "./feature";

// Helper für entity-definitions — fügt eine `customFields jsonb`-Spalte
// hinzu. Consumer:
//
//   const propertyEntity = createEntity({
//     fields: {
//       name: createTextField({ required: true }),
//       customFields: customFieldsField(),
//     },
//   });
//
// Spec-Promise: customFields verhält sich wie Stammfelder. Default `{}`,
// NOT NULL — analog zu embedded-Spalten.
// @wrapper-known semantic-alias
export function customFieldsField(): JsonbFieldDef {
  return createJsonbField();
}

// Vollständige integration der custom-fields-Bundle für eine spezifische
// host-entity. Eine einzige Aufruf-Stelle pro consumer registriert ALLE
// wiring-Aspekte: extension-tracking, MSP für value-projection, rebuild-
// replay via extendEntityProjection, postQuery-hook für API-flatten,
// search-payload-extension für indexable customFields.
//
// Consumer-side:
//
//   defineFeature("property-mgmt", (r) => {
//     r.entity("property", propertyEntity);  // muss customFieldsField() haben
//     r.requires(CUSTOM_FIELDS_FEATURE_NAME);
//     wireCustomFieldsFor(r, "property", propertyTable);
//   });
//
// Der `entityTable`-Parameter ist die Drizzle-Table-Instance (typically
// `buildEntityTable(name, entity)`-Output). Die Closure über `entityTable`
// erspart der MSP-apply-fn einen runtime-table-lookup über die Registry.
//
// **Was registriert wird**:
//
//   1. r.useExtension("customFields", entityName) — opt-in marker,
//      ermöglicht boot-validation und usage-tracking via Registry.
//
//   2. r.multiStreamProjection — consumes customField.set/.cleared events
//      die customer's set-custom-field / clear-custom-field write-handlers
//      emittiert haben. Updated entityTable.customFields jsonb über
//      jsonb_set / jsonb-key-removal.
//
//   3. r.extendEntityProjection — hängt dieselben apply-Handler in die
//      implicit projection der host-entity, damit rebuildProjection die
//      customField-Events mit-replayt. Ohne das fällt customFields bei
//      jedem Entity-Rebuild (Schema-Migration!) auf `{}` zurück (#759).
//
//   4. r.entityHook("postQuery", entity, flatten-fn) — bei JEDEM Read auf
//      diese entity wird `row.customFields` jsonb auf root-level expanded
//      damit die API-response wie Stammfelder aussieht.
//
//   5. r.searchPayloadExtension(entity, contributor) — searchable
//      customFields-keys werden flach ins Meilisearch-Index-Doc beigetragen
//      (F3-wiring).
//
//   6. fieldDefinition.deleted-Event-Handler im selben MSP — bei delete
//      einer fieldDefinition werden orphan values aus allen entity-rows
//      entfernt (key-removal pro fieldKey).
export function wireCustomFieldsFor<TReg extends FeatureRegistrar<string>>(
  r: TReg,
  entityName: string,
  entityTable: unknown,
): void {
  // biome-ignore lint/correctness/useHookAtTopLevel: r.useExtension is a registrar-API method, not a React hook — false positive on the "use"-prefix heuristic.
  r.useExtension(CUSTOM_FIELDS_EXTENSION, entityName);

  // Qualified event-type-names — sourced from typed EventDef.name handles
  // (compile-time literal-typed, no Template-Literal-Drift à la toKebab-
  // collapse-bug die T1 aufgedeckt hat).
  const setEventType = customFieldsFeature.exports.setEvent.name;
  const clearedEventType = customFieldsFeature.exports.clearedEvent.name;
  const fieldDefDeletedType = customFieldsFeature.exports.fieldDefinitionDeletedEvent.name;

  // Geteilte apply-Bodies: die MSP liefert sie live (async cursor), die
  // entity-projection-extension replayt sie in rebuildProjection — gleiche
  // SQL-Helper, beide idempotent. 2-Param-Signatur ist die gemeinsame
  // Teilmenge von MultiStreamApplyFn und SingleStreamApplyFn.
  const applyCustomFieldSet = async (event: StoredEvent, tx: DbRunner): Promise<void> => {
    // skip: feuert für ALLE aggregate-types die customField.set emittieren —
    // wir wollen nur die unserer wired host-entity. Andere consumers haben
    // eigene Wirings für ihre Entities.
    if (event.aggregateType !== entityName) return;
    const payload = event.payload as CustomFieldSetPayload; // @cast-boundary engine-payload

    // skip: a value-less customField.set is an anomaly since #972 (every set
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

    // jsonb_set: setze key auf value. Wenn key noch nicht existiert →
    // wird angelegt (create_missing=true ist default). value muss als
    // jsonb-literal kommen.
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
    // skip: feuert für alle aggregate-types — nur unsere host-entity
    // verarbeiten.
    if (event.aggregateType !== entityName) return;
    const payload = event.payload as CustomFieldClearedPayload; // @cast-boundary engine-payload

    // jsonb minus operator (`-`) entfernt key aus jsonb-object.
    const tableName = extractTableName(entityTable, "custom-fields/wire-for-entity");
    await clearCustomFieldKey(tx, tableName, payload.fieldKey, event.aggregateId, event.tenantId);
  };

  const applyFieldDefinitionDeleted = async (event: StoredEvent, tx: DbRunner): Promise<void> => {
    // fieldDefinition.deleted fires nur einmal pro fieldDef-delete
    // (NICHT per-entity). Wir entfernen den key aus ALLEN rows der host-
    // entity falls die deleted-fieldDef für diese entity galt.
    const payload = event.payload as {
      entityName: string;
      fieldKey: string;
      tenantId?: TenantId;
    }; // @cast-boundary engine-payload
    // skip: fieldDefinition.deleted feuert für ALLE fieldDefs cross-entity;
    // nur wenn die deleted-fieldDef diese host-entity betraf, cleanen wir
    // ihre Rows.
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

  // Rebuild-wiring (#759): ohne das replayt rebuildProjection nur die
  // entity-lifecycle-Events und resettet jede customFields-jsonb auf ihr
  // Default `{}` — die Werte existieren ausschließlich als customField.set/
  // .cleared-Events. set/cleared reiten auf dem HOST-entity-Stream
  // (aggregateType = entityName, von source schon abgedeckt);
  // fieldDefinition.deleted lebt auf dem "field-definition"-Stream und
  // kommt deshalb als extra source dazu.
  r.extendEntityProjection(entityName, {
    sources: [FIELD_DEFINITION_AGGREGATE_TYPE],
    apply: {
      [setEventType]: applyCustomFieldSet,
      [clearedEventType]: applyCustomFieldCleared,
      [fieldDefDeletedType]: applyFieldDefinitionDeleted,
    },
  });

  // postQuery-hook: flatten row.customFields jsonb auf root-level der
  // API-response. Spec-Promise Z.4 "indistinguishable von Stammfeldern".
  r.entityHook("postQuery", entityName, async ({ rows }) => ({
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
  }));

  // Search-Payload-Extension: customFields-keys flach ins Index-Doc.
  // Anders als postQuery-hook (der ALLE keys merged) trägt der Search-
  // Contributor nur die als searchable=true definierten fields bei. v1
  // ist conservatively: ALLES contribuieren — B2-follow-up filtert
  // per fieldDefinition.searchable-flag.
  r.searchPayloadExtension(entityName, ({ state }) => {
    const customFields = state["customFields"];
    if (customFields && typeof customFields === "object" && !Array.isArray(customFields)) {
      return customFields as Record<string, unknown>; // @cast-boundary db-row jsonb runtime-untyped
    }
    return {};
  });
}
