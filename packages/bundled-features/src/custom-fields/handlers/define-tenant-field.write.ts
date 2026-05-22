import {
  createEntityExecutor,
  isSystemTenant,
  type WriteHandlerDef,
} from "@cosmicdrift/kumiko-framework/engine";
import { fieldDefinitionAggregateId } from "../aggregate-id";
import { fieldDefinitionEntity } from "../entity";
import { type DefineFieldPayload, defineFieldPayloadSchema } from "../schemas";

const { executor } = createEntityExecutor("field-definition", fieldDefinitionEntity);

// define-tenant-field — TenantAdmin definiert eine Custom-Field-Definition
// für seinen eigenen Tenant. tenantId wird automatisch aus event.user.tenantId
// abgeleitet (NICHT vom Caller setzbar — verhindert Cross-Tenant-Mutation).
//
// **Same-scope-conflict** wird natürlich durch aggregate-version-conflict
// enforced: deterministische aggregate-id aus uuidv5(tenant, entity, fieldKey)
// macht einen zweiten Create auf dieselbe Definition ein version_conflict.
// Dispatcher returnt 409. Saubere Idempotency-Garantie ohne extra DB-roundtrip.
//
// **Cross-scope-conflict** (tenant versucht fieldKey zu definieren der bereits
// system-scope existiert) wird in B1 NICHT enforced — aggregate-ids
// unterscheiden sich (verschiedene tenantIds in uuidv5), beide writes gehen
// durch. Resolution beim Read (B2) zeigt dann den system-scope-Wert. v2
// kann r.systemScope-Sub-Handler einführen um cross-scope-conflict am Write
// abzulehnen.
export const defineTenantFieldHandler: WriteHandlerDef = {
  name: "define-tenant-field",
  schema: defineFieldPayloadSchema,
  access: { roles: ["TenantAdmin"] },
  handler: async (event, ctx) => {
    const payload = event.payload as DefineFieldPayload; // @cast-boundary engine-payload
    const tenantId = event.user.tenantId;

    // TenantAdmin darf NICHT system-scope schreiben — strict-guard.
    if (isSystemTenant(tenantId)) {
      throw new Error(
        "define-tenant-field: tenantId is SYSTEM_TENANT_ID — use define-system-field for system-scope definitions",
      );
    }

    const aggregateId = fieldDefinitionAggregateId(tenantId, payload.entityName, payload.fieldKey);

    return executor.create(
      {
        id: aggregateId,
        entityName: payload.entityName,
        fieldKey: payload.fieldKey,
        type: payload.serializedField.type,
        required: payload.required,
        searchable: payload.searchable,
        displayOrder: payload.displayOrder,
        serializedField: JSON.stringify({
          ...payload.serializedField,
          label: payload.label,
        }),
      },
      event.user,
      ctx.db,
    );
  },
};
