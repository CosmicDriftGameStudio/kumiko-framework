import { SYSTEM_TENANT_ID, type WriteHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import { requireForTenant } from "../../shared/index.js";
import { fieldDefinitionAggregateId } from "../aggregate-id.js";
import { FIELD_DEFINITION_AGGREGATE_TYPE } from "../constants.js";
import { fieldDefinitionExecutor } from "../executor.js";
import { customFieldsFeature } from "../feature.js";
import { type DeleteFieldPayload, deleteFieldPayloadSchema } from "../schemas.js";

// delete-system-field — SystemAdmin entfernt eine system-weite Field-
// Definition. Konsequenz: KEIN Tenant kann mehr neue Werte dafür setzen,
// existing Werte in read_<entity>.customFields jsonb bleiben aber bestehen
// (B2's MSP wird sie via customFieldDefinition.deleted-Event aufräumen).
// Events bleiben für Audit.
export const deleteSystemFieldHandler: WriteHandlerDef = {
  name: "delete-system-field",
  schema: deleteFieldPayloadSchema,
  access: { roles: ["SystemAdmin"] },
  description:
    "Deletes a system-tenant custom-field definition and cascades an event that strips the now-orphaned values out of every tenant's host rows; use it to retire a platform-wide field for all tenants at once.",
  agent: { risk: "high" },
  handler: async (event, ctx) => {
    const payload = event.payload as DeleteFieldPayload; // @cast-boundary engine-payload

    const aggregateId = fieldDefinitionAggregateId(
      SYSTEM_TENANT_ID,
      payload.entityName,
      payload.fieldKey,
    );

    const { db, streamTenantId } = requireForTenant(ctx, SYSTEM_TENANT_ID);
    const result = await fieldDefinitionExecutor.delete({ id: aggregateId }, event.user, db, {
      streamTenantId,
    });

    // Cascade-cleanup-Event — host-entity-MSPs entfernen orphan values aus
    // ihrer customFields jsonb. Im selben TX = atomic.
    if (result.isSuccess) {
      await ctx.unsafeAppendEvent({
        aggregateId,
        aggregateType: FIELD_DEFINITION_AGGREGATE_TYPE,
        type: customFieldsFeature.exports.fieldDefinitionDeletedEvent.name,
        payload: {
          entityName: payload.entityName,
          fieldKey: payload.fieldKey,
          tenantId: SYSTEM_TENANT_ID,
        },
      });
    }

    return result;
  },
};
