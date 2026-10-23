import { SYSTEM_TENANT_ID, type WriteHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import { requireForTenant } from "../../shared/index.ts";
import { fieldDefinitionAggregateId } from "../aggregate-id.ts";
import { fieldDefinitionExecutor } from "../executor.ts";
import { createCustomFieldsFeature } from "../feature.ts";
import { type DeleteFieldPayload, deleteFieldPayloadSchema } from "../schemas.ts";
import { FIELD_DEFINITION_AGGREGATE_TYPE } from "../web/constants.ts";

// delete-system-field — SystemAdmin deletes a system-wide field definition.
// Tenants can no longer set new values for it, but existing values remain in
// read_<entity>.customFields jsonb until host-entity MSPs remove them in
// response to the customFieldDefinition.deleted event. Events remain for audit.
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

    // Cascade-cleanup event — host-entity MSPs remove orphaned values from their
    // customFields jsonb in the same transaction for atomicity.
    if (result.isSuccess) {
      await ctx.events.unsafeAppend({
        aggregateId,
        aggregateType: FIELD_DEFINITION_AGGREGATE_TYPE,
        type: createCustomFieldsFeature().exports.fieldDefinitionDeletedEvent.name,
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
