import {
  createJsonbField,
  type FeatureRegistrar,
  type JsonbFieldDef,
} from "@cosmicdrift/kumiko-framework/engine";
import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import { getTableName } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { CUSTOM_FIELDS_EXTENSION } from "./constants";
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
export function customFieldsField(): JsonbFieldDef {
  return createJsonbField();
}

// Vollständige integration der custom-fields-Bundle für eine spezifische
// host-entity. Eine einzige Aufruf-Stelle pro consumer registriert ALLE
// wiring-Aspekte: extension-tracking, MSP für value-projection, postQuery-
// hook für API-flatten, search-payload-extension für indexable customFields.
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
// `buildDrizzleTable(name, entity)`-Output). Die Closure über `entityTable`
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
//   3. r.entityHook("postQuery", entity, flatten-fn) — bei JEDEM Read auf
//      diese entity wird `row.customFields` jsonb auf root-level expanded
//      damit die API-response wie Stammfelder aussieht.
//
//   4. r.searchPayloadExtension(entity, contributor) — searchable
//      customFields-keys werden flach ins Meilisearch-Index-Doc beigetragen
//      (F3-wiring).
//
//   5. fieldDefinition.deleted-Event-Handler im selben MSP — bei delete
//      einer fieldDefinition werden orphan values aus allen entity-rows
//      entfernt (key-removal pro fieldKey).
export function wireCustomFieldsFor<TReg extends FeatureRegistrar<string>>(
  r: TReg,
  entityName: string,
  entityTable: PgTable,
): void {
  // biome-ignore lint/correctness/useHookAtTopLevel: r.useExtension is a registrar-API method, not a React hook — false positive on the "use"-prefix heuristic.
  r.useExtension(CUSTOM_FIELDS_EXTENSION, entityName);

  // Qualified event-type-names — sourced from typed EventDef.name handles
  // (compile-time literal-typed, no Template-Literal-Drift à la toKebab-
  // collapse-bug die T1 aufgedeckt hat).
  const setEventType = customFieldsFeature.exports.setEvent.name;
  const clearedEventType = customFieldsFeature.exports.clearedEvent.name;
  const fieldDefDeletedType = customFieldsFeature.exports.fieldDefinitionDeletedEvent.name;

  r.multiStreamProjection({
    name: `custom-fields-${entityName}-projection`,
    apply: {
      [setEventType]: async (event, tx) => {
        // skip: MSP feuert für ALLE aggregate-types die customField.set
        // emittieren — wir wollen nur die unserer wired host-entity.
        // Andere consumers haben eigene MSPs für ihre Entities.
        if (event.aggregateType !== entityName) return;
        const payload = event.payload as CustomFieldSetPayload; // @cast-boundary engine-payload

        // jsonb_set: setze key auf value. Wenn key noch nicht existiert →
        // wird angelegt (create_missing=true ist default). value muss als
        // jsonb-literal kommen.
        const tbl = `"${getTableName(entityTable)}"`;
        const escapedKey = payload.fieldKey.replace(/'/g, "''");
        await asRawClient(tx).unsafe(
          `UPDATE ${tbl} SET custom_fields = jsonb_set(custom_fields, '{${escapedKey}}', $1::jsonb, true) WHERE id = $2`,
          [JSON.stringify(payload.value), event.aggregateId],
        );
      },
      [clearedEventType]: async (event, tx) => {
        // skip: MSP feuert für alle aggregate-types — nur unsere host-entity
        // verarbeiten.
        if (event.aggregateType !== entityName) return;
        const payload = event.payload as CustomFieldClearedPayload; // @cast-boundary engine-payload

        // jsonb minus operator (`-`) entfernt key aus jsonb-object.
        const tbl = `"${getTableName(entityTable)}"`;
        await asRawClient(tx).unsafe(
          `UPDATE ${tbl} SET custom_fields = custom_fields - $1 WHERE id = $2`,
          [payload.fieldKey, event.aggregateId],
        );
      },
      [fieldDefDeletedType]: async (event, tx) => {
        // fieldDefinition.deleted fires nur einmal pro fieldDef-delete
        // (NICHT per-entity). Wir entfernen den key aus ALLEN rows der host-
        // entity falls die deleted-fieldDef für diese entity galt.
        const payload = event.payload as { entityName: string; fieldKey: string }; // @cast-boundary engine-payload
        // skip: fieldDefinition.deleted feuert für ALLE fieldDefs cross-entity;
        // nur wenn die deleted-fieldDef diese host-entity betraf, cleanen wir
        // ihre Rows.
        if (payload.entityName !== entityName) return;

        const tbl = `"${getTableName(entityTable)}"`;
        await asRawClient(tx).unsafe(
          `UPDATE ${tbl} SET custom_fields = custom_fields - $1`,
          [payload.fieldKey],
        );
      },
    },
  });

  // postQuery-hook: flatten row.customFields jsonb auf root-level der
  // API-response. Spec-Promise Z.4 "indistinguishable von Stammfeldern".
  r.entityHook("postQuery", entityName, async ({ rows }) => ({
    rows: rows.map((row) => {
      const customFields = row["customFields"];
      if (customFields && typeof customFields === "object" && !Array.isArray(customFields)) {
        return {
          ...row,
          ...(customFields as Record<string, unknown>), // @cast-boundary db-row jsonb runtime-untyped
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
