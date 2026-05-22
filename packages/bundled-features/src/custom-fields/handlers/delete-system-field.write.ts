import {
  createEntityExecutor,
  SYSTEM_TENANT_ID,
  type WriteHandlerDef,
} from "@cosmicdrift/kumiko-framework/engine";
import { fieldDefinitionAggregateId } from "../aggregate-id";
import { fieldDefinitionEntity } from "../entity";
import { type DeleteFieldPayload, deleteFieldPayloadSchema } from "../schemas";

const { executor } = createEntityExecutor("field-definition", fieldDefinitionEntity);

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
    return executor.delete({ id: aggregateId }, systemUser, ctx.db);
  },
};
