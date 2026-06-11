import { isSystemTenant, type WriteHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import { failNotFound, failUnprocessable } from "@cosmicdrift/kumiko-framework/errors";
import { fieldDefinitionAggregateId } from "../aggregate-id";
import { fieldDefinitionExecutor } from "../executor";
import { buildFieldDefinitionColumns } from "../lib/field-definition-row";
import { type UpdateFieldPayload, updateFieldPayloadSchema } from "../schemas";

// update-tenant-field — TenantAdmin ersetzt den Stand einer bestehenden
// Field-Definition (Vollersatz: Payload-Shape = define, der Edit-Screen
// schickt den kompletten neuen Stand). Identität ist (entityName, fieldKey)
// → deterministische aggregate-id wie bei define/delete; tenantId kommt
// aus event.user (Cross-Tenant-Mutation unmöglich, fremde Definitionen
// derivieren auf eine andere aggregate-id → 404).
//
// **type ist immutable.** Ein Type-Wechsel würde bestehende Values in den
// host-entity customFields-jsonbs verwaisen (text-Wert unter number-Feld);
// dafür ist delete + re-define der ehrliche Weg (Bug-Bash D2: bewusst KEIN
// delete+redefine im update — das würde Event-Historie + Field-Ids
// zerstören, aber ein Type-Wechsel will genau diese Zäsur).
//
// **Bekannte MVP-Grenze (bewusst):** der Edit reconciled bestehende
// Host-Werte NICHT gegen die neue Definition — Constraint-Narrowing
// (enum-Wert weg, min/max enger) lässt alte Werte still non-conformant,
// required false→true macht Bestands-Rows unvollständig, searchable-Toggle
// re-indexed nicht. Werte werden beim NÄCHSTEN Write der Host-Row gegen
// die aktuelle Def validiert; eine Reject-mit-Konflikt-Liste-Variante
// wäre der Ausbau, wenn der Bedarf real wird.
//
// **skipOptimisticLock:** Definition-Edits sind admin-only + low-frequency
// (gleiche Abwägung wie der Quota-soft-cap in define). Last-write-wins
// statt version-Roundtrip durch den Edit-Screen.
export const updateTenantFieldHandler: WriteHandlerDef = {
  name: "update-tenant-field",
  schema: updateFieldPayloadSchema,
  access: { roles: ["TenantAdmin"] },
  handler: async (event, ctx) => {
    const payload = event.payload as UpdateFieldPayload; // @cast-boundary engine-payload
    const tenantId = event.user.tenantId;

    if (isSystemTenant(tenantId)) {
      throw new Error(
        "update-tenant-field: tenantId is SYSTEM_TENANT_ID — system-scope definitions have no update handler (delete + re-define via the system-field handlers)",
      );
    }

    const aggregateId = fieldDefinitionAggregateId(tenantId, payload.entityName, payload.fieldKey);

    const existing = await fieldDefinitionExecutor.detail({ id: aggregateId }, event.user, ctx.db);
    if (!existing) {
      return failNotFound("field-definition", aggregateId);
    }

    if (existing["type"] !== payload.serializedField.type) {
      return failUnprocessable("field_type_immutable", {
        entityName: payload.entityName,
        fieldKey: payload.fieldKey,
        currentType: existing["type"],
        requestedType: payload.serializedField.type,
      });
    }

    // entityName/fieldKey sind die Identität — nicht Teil der changes.
    const {
      entityName: _entityName,
      fieldKey: _fieldKey,
      ...changes
    } = buildFieldDefinitionColumns(payload);

    return fieldDefinitionExecutor.update({ id: aggregateId, changes }, event.user, ctx.db, {
      skipOptimisticLock: true,
    });
  },
};
