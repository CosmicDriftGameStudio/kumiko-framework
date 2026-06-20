import { SYSTEM_TENANT_ID, type WriteHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import { fieldDefinitionAggregateId } from "../aggregate-id";
import { defineOrResurrectFieldDefinition } from "../lib/define-or-resurrect";
import { buildFieldDefinitionColumns } from "../lib/field-definition-row";
import { type DefineFieldPayload, defineFieldPayloadSchema } from "../schemas";

// define-system-field — SystemAdmin definiert eine system-weite Custom-Field-
// Definition die für ALLE Tenants gilt. tenantId wird auf SYSTEM_TENANT_ID
// gesetzt (NICHT vom Caller — SystemAdmin's event.user.tenantId würde sonst
// auf den admin's eigenen platform-tenant zeigen).
//
// **Use-Case:** Vendor (cdgs) sagt "alle Hausverwaltungs-customers haben ab
// heute ein `internalNumber`-Field". Tenant kann den Wert pro customer
// setzen, aber die Definition nicht ändern oder löschen.
//
// **Same-scope-conflict** wie bei define-tenant-field via aggregate-version-
// conflict (deterministische ID mit tenantId=SYSTEM_TENANT_ID).
export const defineSystemFieldHandler: WriteHandlerDef = {
  name: "define-system-field",
  schema: defineFieldPayloadSchema,
  access: { roles: ["SystemAdmin"] },
  handler: async (event, ctx) => {
    const payload = event.payload as DefineFieldPayload; // @cast-boundary engine-payload

    const aggregateId = fieldDefinitionAggregateId(
      SYSTEM_TENANT_ID,
      payload.entityName,
      payload.fieldKey,
    );

    // Override event.user.tenantId to SYSTEM_TENANT_ID for the system-scope
    // write. The framework's CrudExecutor writes the row with this tenantId
    // — the row lives in the system-scope-stream.
    const systemUser = { ...event.user, tenantId: SYSTEM_TENANT_ID };

    return defineOrResurrectFieldDefinition(
      aggregateId,
      buildFieldDefinitionColumns(payload),
      systemUser,
      ctx.db,
    );
  },
};
