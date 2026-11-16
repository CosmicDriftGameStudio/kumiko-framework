import { isSystemTenant, type WriteHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import { failUnprocessable } from "@cosmicdrift/kumiko-framework/errors";
import { fieldDefinitionAggregateId } from "../aggregate-id.ts";
import { isCustomFieldsHost } from "../lib/custom-fields-host.ts";
import { defineOrResurrectFieldDefinition } from "../lib/define-or-resurrect.ts";
import { buildFieldDefinitionColumns } from "../lib/field-definition-row.ts";
import { countTenantFieldDefinitions } from "../db/queries/quota.ts";
import { type DefineFieldPayload, defineFieldPayloadSchema } from "../schemas.ts";
import { DEFAULT_FIELD_DEFINITION_WRITE_ROLES } from "../web/constants.ts";

// define-tenant-field: the tenant is taken from event.user.tenantId, never from the payload.
// Same-scope conflicts surface as a version_conflict through the deterministic aggregate id.
// The limit is a soft cap: concurrent defines can overshoot it, which is accepted for a
// low-frequency admin action.
export interface DefineTenantFieldOptions {
  /** Soft cap — `>= limit` definitions per tenant rejects further defines (see header: concurrent defines may overshoot). */
  readonly fieldDefinitionLimitPerTenant?: number;
  /** Access roles for this handler. Default ["TenantAdmin"] — apps with
   *  their own role vocabulary pass this via createCustomFieldsFeature({
   *  fieldDefinitionWriteRoles }), which threads the same roles into
   *  update-/delete-tenant-field too (the definition-CRUD triad shares one gate). */
  readonly roles?: readonly string[];
}

const DEFINE_TENANT_FIELD_REASON =
  "counts custom field definitions with an explicit tenant_id = caller tenant via raw SQL with read retry";

export function createDefineTenantFieldHandler(
  opts: DefineTenantFieldOptions = {},
): WriteHandlerDef {
  const limit = opts.fieldDefinitionLimitPerTenant;
  return {
    name: "define-tenant-field",
    schema: defineFieldPayloadSchema,
    access: { roles: opts.roles ?? DEFAULT_FIELD_DEFINITION_WRITE_ROLES },
    description:
      "Creates a custom-field definition owned by the caller's own tenant on the named entity, rejecting the write once the tenant's definition quota is reached; use it when one tenant needs an extra field the other tenants must not see.",
    escapeHatch: {
      grants: ["unsafeRaw"],
      reason: DEFINE_TENANT_FIELD_REASON,
    },
    handler: async (event, ctx) => {
      const payload = event.payload as DefineFieldPayload; // @cast-boundary engine-payload
      if (!isCustomFieldsHost(ctx.registry, payload.entityName)) {
        return failUnprocessable("custom_fields_entity_not_wired", {
          entityName: payload.entityName,
        });
      }
      const tenantId = event.user.tenantId;

      // TenantAdmin MUST NOT write to the system scope — strict guard.
      if (isSystemTenant(tenantId)) {
        throw new Error(
          "define-tenant-field: tenantId is SYSTEM_TENANT_ID — use define-system-field for system-scope definitions",
        );
      }

      if (limit !== undefined) {
        const current = await countTenantFieldDefinitions(ctx.db.unsafeRaw(), tenantId);
        if (current >= limit) {
          return failUnprocessable("cap_exceeded", {
            capName: "customFields.fieldDefinition.count",
            limit,
            current,
          });
        }
      }

      const aggregateId = fieldDefinitionAggregateId(
        tenantId,
        payload.entityName,
        payload.fieldKey,
      );

      return defineOrResurrectFieldDefinition(
        aggregateId,
        buildFieldDefinitionColumns(payload),
        event.user,
        ctx.db,
      );
    },
  };
}
