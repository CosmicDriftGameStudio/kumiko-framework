import { SYSTEM_TENANT_ID, type WriteHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import { requireForTenant } from "../../shared/index.ts";
import { fieldDefinitionAggregateId } from "../aggregate-id.ts";
import { defineOrResurrectFieldDefinition } from "../lib/define-or-resurrect.ts";
import { buildFieldDefinitionColumns } from "../lib/field-definition-row.ts";
import { type DefineFieldPayload, defineFieldPayloadSchema } from "../schemas.ts";

// A system-wide field definition applies to every tenant. tenantId is forced to
// SYSTEM_TENANT_ID (never taken from the caller) and addressed via streamTenantId,
// so the SystemAdmin stays the recorded actor. Tenants can set values for the field
// but cannot change or delete the definition. A same-scope duplicate surfaces as an
// aggregate version conflict, because the ID is derived from SYSTEM_TENANT_ID.
export const defineSystemFieldHandler: WriteHandlerDef = {
  name: "define-system-field",
  schema: defineFieldPayloadSchema,
  access: { roles: ["SystemAdmin"] },
  description:
    "Creates a custom-field definition under the system tenant so every tenant inherits the field on the named entity; use it for platform-mandated fields that individual tenants may fill in but never edit or delete.",
  handler: async (event, ctx) => {
    const payload = event.payload as DefineFieldPayload; // @cast-boundary engine-payload

    const aggregateId = fieldDefinitionAggregateId(
      SYSTEM_TENANT_ID,
      payload.entityName,
      payload.fieldKey,
    );

    const { db, streamTenantId } = requireForTenant(ctx, SYSTEM_TENANT_ID);

    return defineOrResurrectFieldDefinition(
      aggregateId,
      buildFieldDefinitionColumns(payload),
      event.user,
      db,
      streamTenantId,
    );
  },
};
