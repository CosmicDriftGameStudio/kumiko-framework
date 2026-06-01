import {
  createJsonbField,
  type FeatureRegistrar,
  isSystemTenant,
  type JsonbFieldDef,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { CUSTOM_FIELDS_EXTENSION } from "./constants";
import {
  clearCustomFieldKey,
  removeCustomFieldKeyForTenant,
  removeCustomFieldKeyFromAllTenants,
  setCustomFieldValue,
} from "./db/queries/projection";

const KUMIKO_NAME_SYMBOL = Symbol.for("kumiko:schema:Name");
function getTableName(table: unknown): string {
  if (typeof table === "object" && table !== null) {
    const sym = (table as Record<symbol, unknown>)[KUMIKO_NAME_SYMBOL];
    if (typeof sym === "string") return sym;
  }
  throw new Error("wire-for-entity: table missing kumiko:schema:Name symbol");
}

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
        const tableName = getTableName(entityTable);
        await setCustomFieldValue(
          tx,
          tableName,
          payload.fieldKey,
          payload.value,
          event.aggregateId,
          event.tenantId,
        );
      },
      [clearedEventType]: async (event, tx) => {
        // skip: MSP feuert für alle aggregate-types — nur unsere host-entity
        // verarbeiten.
        if (event.aggregateType !== entityName) return;
        const payload = event.payload as CustomFieldClearedPayload; // @cast-boundary engine-payload

        // jsonb minus operator (`-`) entfernt key aus jsonb-object.
        const tableName = getTableName(entityTable);
        await clearCustomFieldKey(
          tx,
          tableName,
          payload.fieldKey,
          event.aggregateId,
          event.tenantId,
        );
      },
      [fieldDefDeletedType]: async (event, tx) => {
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

        const tableName = getTableName(entityTable);
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
