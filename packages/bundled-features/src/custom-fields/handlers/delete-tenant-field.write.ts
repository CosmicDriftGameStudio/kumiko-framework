import {
  createEntityExecutor,
  isSystemTenant,
  type WriteHandlerDef,
} from "@cosmicdrift/kumiko-framework/engine";
import { fieldDefinitionAggregateId } from "../aggregate-id";
import { fieldDefinitionEntity } from "../entity";
import { type DeleteFieldPayload, deleteFieldPayloadSchema } from "../schemas";

const { executor } = createEntityExecutor("field-definition", fieldDefinitionEntity);

// delete-tenant-field — TenantAdmin löscht eigene Field-Definition.
// Spec-Promise (Plan-Doc v2 "wie Entity-Delete"): Events bleiben im event-
// store für Audit-Trail. Read-Projection-Row wird entfernt. B2 wird die
// Cleanup-Pipeline (`customFieldDefinition.deleted`-Event → MSP entfernt
// values aus read_<entity>.customFields jsonb) wirklich wiren — in B1
// kümmern wir uns nur um die Definition selbst.
//
// **Idempotency:** Delete auf nicht-existente Definition → version_conflict
// (executor.delete returns failure, dispatcher 404/422). Caller sieht "not
// found" — kein Crash.
export const deleteTenantFieldHandler: WriteHandlerDef = {
  name: "delete-tenant-field",
  schema: deleteFieldPayloadSchema,
  access: { roles: ["TenantAdmin"] },
  handler: async (event, ctx) => {
    const payload = event.payload as DeleteFieldPayload; // @cast-boundary engine-payload
    const tenantId = event.user.tenantId;

    if (isSystemTenant(tenantId)) {
      throw new Error(
        "delete-tenant-field: tenantId is SYSTEM_TENANT_ID — use delete-system-field for system-scope deletions",
      );
    }

    const aggregateId = fieldDefinitionAggregateId(tenantId, payload.entityName, payload.fieldKey);

    return executor.delete({ id: aggregateId }, event.user, ctx.db);
  },
};
