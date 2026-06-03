import { SYSTEM_TENANT_ID, type WriteHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import { fieldDefinitionAggregateId } from "../aggregate-id";
import { fieldDefinitionExecutor } from "../executor";
import { customFieldsFeature } from "../feature";
import { type DeleteFieldPayload, deleteFieldPayloadSchema } from "../schemas";

// delete-system-field — SystemAdmin entfernt eine system-weite Field-
// Definition. Konsequenz: KEIN Tenant kann mehr neue Werte dafür setzen,
// existing Werte in read_<entity>.customFields jsonb bleiben aber bestehen
// (B2's MSP wird sie via customFieldDefinition.deleted-Event aufräumen).
// Events bleiben für Audit.
export const deleteSystemFieldHandler: WriteHandlerDef = {
  name: "delete-system-field",
  schema: deleteFieldPayloadSchema,
  access: { roles: ["SystemAdmin"] },
  handler: async (event, ctx) => {
    const payload = event.payload as DeleteFieldPayload; // @cast-boundary engine-payload

    const aggregateId = fieldDefinitionAggregateId(
      SYSTEM_TENANT_ID,
      payload.entityName,
      payload.fieldKey,
    );

    const systemUser = { ...event.user, tenantId: SYSTEM_TENANT_ID };
    const result = await fieldDefinitionExecutor.delete({ id: aggregateId }, systemUser, ctx.db);

    // Cascade-cleanup-Event — host-entity-MSPs entfernen orphan values aus
    // ihrer customFields jsonb. Im selben TX = atomic.
    if (result.isSuccess) {
      await ctx.unsafeAppendEvent({
        aggregateId,
        aggregateType: "field-definition",
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
