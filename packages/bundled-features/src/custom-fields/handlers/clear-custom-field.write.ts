import type { WriteHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import { failNotFound, failUnprocessable } from "@cosmicdrift/kumiko-framework/errors";
import { z } from "zod";
import { customFieldsFeature } from "../feature";
import { checkFieldAccessForWrite } from "../lib/field-access";

export const clearCustomFieldPayloadSchema = z.object({
  entityName: z.string().min(1).max(64),
  entityId: z.string().min(1),
  fieldKey: z.string().min(1).max(64),
});
export type ClearCustomFieldPayload = z.infer<typeof clearCustomFieldPayloadSchema>;

// clear-custom-field — entfernt einen Custom-Field-Wert von einer host-
// entity. Emittiert customField.cleared-Event; MSP entfernt key aus
// jsonb-column (key-removal, nicht null-set).
//
// T1.5b: per-field fieldAccess.write gate — caller muss eine der definierten
// Rollen halten falls fieldDefinition.serializedField.fieldAccess.write
// gesetzt ist. Handler-level RBAC (TenantAdmin/Member) bleibt zusätzlich.
export const clearCustomFieldHandler: WriteHandlerDef = {
  name: "clear-custom-field",
  schema: clearCustomFieldPayloadSchema,
  access: { roles: ["TenantAdmin", "TenantMember"] },
  handler: async (event, ctx) => {
    const payload = event.payload as ClearCustomFieldPayload; // @cast-boundary engine-payload

    const accessCheck = await checkFieldAccessForWrite(
      ctx.db,
      event.user.tenantId,
      payload.entityName,
      payload.fieldKey,
      event.user.roles,
    );
    if (!accessCheck.ok) {
      if (accessCheck.reason === "field_definition_not_found") {
        return failNotFound("fieldDefinition", payload.fieldKey);
      }
      if (accessCheck.reason === "field_definition_corrupt") {
        return failUnprocessable("field_definition_corrupt", { fieldKey: payload.fieldKey });
      }
      return failUnprocessable("field_access_denied", {
        fieldKey: payload.fieldKey,
        requiredRoles: accessCheck.requiredRoles ?? [],
      });
    }

    await ctx.unsafeAppendEvent({
      aggregateId: payload.entityId,
      aggregateType: payload.entityName,
      type: customFieldsFeature.exports.clearedEvent.name,
      payload: { fieldKey: payload.fieldKey },
    });

    return {
      isSuccess: true as const,
      data: { entityName: payload.entityName, entityId: payload.entityId },
    };
  },
};
