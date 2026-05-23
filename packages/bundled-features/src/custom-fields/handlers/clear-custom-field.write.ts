import type { WriteHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { customFieldsFeature } from "../feature";

export const clearCustomFieldPayloadSchema = z.object({
  entityName: z.string().min(1).max(64),
  entityId: z.string().min(1),
  fieldKey: z.string().min(1).max(64),
});
export type ClearCustomFieldPayload = z.infer<typeof clearCustomFieldPayloadSchema>;

// clear-custom-field — entfernt einen Custom-Field-Wert von einer host-
// entity. Emittiert customField.cleared-Event; MSP entfernt key aus
// jsonb-column (key-removal, nicht null-set).
export const clearCustomFieldHandler: WriteHandlerDef = {
  name: "clear-custom-field",
  schema: clearCustomFieldPayloadSchema,
  access: { roles: ["TenantAdmin", "TenantMember"] },
  handler: async (event, ctx) => {
    const payload = event.payload as ClearCustomFieldPayload; // @cast-boundary engine-payload

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
