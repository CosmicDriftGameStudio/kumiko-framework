import { isSystemTenant, type WriteHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import { fieldDefinitionAggregateId } from "../aggregate-id.ts";
import { fieldDefinitionExecutor } from "../executor.ts";
import { createCustomFieldsFeature } from "../feature.ts";
import { type DeleteFieldPayload, deleteFieldPayloadSchema } from "../schemas.ts";
import {
  DEFAULT_FIELD_DEFINITION_WRITE_ROLES,
  FIELD_DEFINITION_AGGREGATE_TYPE,
} from "../web/constants.ts";

// delete-tenant-field — TenantAdmin deletes their own field definition.
// Events remain in the event store for the audit trail, while the read-projection
// row is removed. The cleanup pipeline (`customFieldDefinition.deleted`-Event → MSP
// removes values from read_<entity>.customFields jsonb) is wired separately; this
// handler only manages the definition itself.
//
// **Idempotency:** Deleting a non-existent definition results in version_conflict
// (executor.delete returns failure, dispatcher 404/422). The caller sees "not
// found" rather than an exception.
export interface DeleteTenantFieldOptions {
  /** Access roles for this handler. Default ["TenantAdmin"] — see
   *  DefineTenantFieldOptions.roles, the definition-CRUD triad shares one gate. */
  readonly roles?: readonly string[];
}

export function createDeleteTenantFieldHandler(
  opts: DeleteTenantFieldOptions = {},
): WriteHandlerDef {
  return {
    name: "delete-tenant-field",
    schema: deleteFieldPayloadSchema,
    access: { roles: opts.roles ?? DEFAULT_FIELD_DEFINITION_WRITE_ROLES },
    description:
      "Deletes one of the caller's own tenant's custom-field definitions and cascades an event that strips its orphaned values out of that tenant's host rows; use it to retire a field this tenant defined itself.",
    agent: { risk: "high" },
    handler: async (event, ctx) => {
      const payload = event.payload as DeleteFieldPayload; // @cast-boundary engine-payload
      const tenantId = event.user.tenantId;

      if (isSystemTenant(tenantId)) {
        throw new Error(
          "delete-tenant-field: tenantId is SYSTEM_TENANT_ID — use delete-system-field for system-scope deletions",
        );
      }

      const aggregateId = fieldDefinitionAggregateId(
        tenantId,
        payload.entityName,
        payload.fieldKey,
      );

      const result = await fieldDefinitionExecutor.delete({ id: aggregateId }, event.user, ctx.db);

      // Emit the cascade-cleanup event after a successful delete. Host-entity MSPs
      // registered via wireCustomFieldsFor consume it and remove orphaned values
      // from their customFields jsonb. The same transaction makes cleanup atomic.
      if (result.isSuccess) {
        await ctx.unsafeAppendEvent({
          aggregateId,
          aggregateType: FIELD_DEFINITION_AGGREGATE_TYPE,
          type: createCustomFieldsFeature().exports.fieldDefinitionDeletedEvent.name,
          payload: { entityName: payload.entityName, fieldKey: payload.fieldKey, tenantId },
        });
      }

      return result;
    },
  };
}

// Backwards-compat: existing imports of `deleteTenantFieldHandler` keep
// working — identical to createDeleteTenantFieldHandler() with default roles.
export const deleteTenantFieldHandler: WriteHandlerDef = createDeleteTenantFieldHandler();
