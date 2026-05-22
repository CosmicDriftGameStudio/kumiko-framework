import {
  createJsonbField,
  type FeatureRegistrar,
  type JsonbFieldDef,
} from "@cosmicdrift/kumiko-framework/engine";
import type { AnyColumn } from "drizzle-orm";
import { eq, sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import {
  CUSTOM_FIELD_CLEARED_EVENT,
  CUSTOM_FIELD_SET_EVENT,
  CUSTOM_FIELDS_EXTENSION,
  CUSTOM_FIELDS_FEATURE_NAME,
  FIELD_DEFINITION_DELETED_EVENT,
} from "./constants";
import type { CustomFieldClearedPayload, CustomFieldSetPayload } from "./events";

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

  // SQL-template helpers — qualified event-type-names.
  const setEventType = `${CUSTOM_FIELDS_FEATURE_NAME}:event:${CUSTOM_FIELD_SET_EVENT}`;
  const clearedEventType = `${CUSTOM_FIELDS_FEATURE_NAME}:event:${CUSTOM_FIELD_CLEARED_EVENT}`;
  const fieldDefDeletedType = `${CUSTOM_FIELDS_FEATURE_NAME}:event:${FIELD_DEFINITION_DELETED_EVENT}`;

  r.multiStreamProjection({
    name: `custom-fields-${entityName}-projection`,
    apply: {
      [setEventType]: async (event, tx) => {
        // Filter — MSP feuert für ALLE aggregate-types, wir wollen nur
        // events auf unsere host-entity.
        if (event.aggregateType !== entityName) return;
        const payload = event.payload as CustomFieldSetPayload; // @cast-boundary engine-payload

        // jsonb_set: setze key auf value. Wenn key noch nicht existiert →
        // wird angelegt (create_missing=true ist default). value muss als
        // jsonb-literal kommen — Drizzle sql-template stringifiziert für uns.
        const idCol = (entityTable as unknown as Record<string, AnyColumn>)["id"] as AnyColumn; // @cast-boundary db-row
        await tx
          .update(entityTable)
          .set({
            customFields: sql`jsonb_set(${sql.identifier("custom_fields")}, ${sql.raw(`'{${payload.fieldKey.replace(/'/g, "''")}}'`)}, ${JSON.stringify(payload.value)}::jsonb, true)`,
          })
          .where(eq(idCol, event.aggregateId));
      },
      [clearedEventType]: async (event, tx) => {
        if (event.aggregateType !== entityName) return;
        const payload = event.payload as CustomFieldClearedPayload; // @cast-boundary engine-payload

        // jsonb minus operator (`-`) entfernt key aus jsonb-object.
        const idCol = (entityTable as unknown as Record<string, AnyColumn>)["id"] as AnyColumn; // @cast-boundary db-row
        await tx
          .update(entityTable)
          .set({
            customFields: sql`${sql.identifier("custom_fields")} - ${payload.fieldKey}`,
          })
          .where(eq(idCol, event.aggregateId));
      },
      [fieldDefDeletedType]: async (event, tx) => {
        // fieldDefinition.deleted fires nur einmal pro fieldDef-delete
        // (NICHT per-entity). Wir entfernen den key aus ALLEN rows der host-
        // entity falls die deleted-fieldDef für diese entity galt.
        const payload = event.payload as { entityName: string; fieldKey: string }; // @cast-boundary engine-payload
        if (payload.entityName !== entityName) return;

        await tx.update(entityTable).set({
          customFields: sql`${sql.identifier("custom_fields")} - ${payload.fieldKey}`,
        });
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
