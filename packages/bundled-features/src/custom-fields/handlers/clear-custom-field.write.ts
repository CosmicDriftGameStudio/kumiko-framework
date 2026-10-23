import type { WriteHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import { failNotFound, failUnprocessable } from "@cosmicdrift/kumiko-framework/errors";
import * as z from "zod";
import { createCustomFieldsFeature } from "../feature.ts";
import { checkFieldAccessForWrite } from "../lib/field-access.ts";
import { DEFAULT_VALUE_WRITE_ROLES } from "../web/constants.ts";

export const clearCustomFieldPayloadSchema = z.object({
  entityName: z.string().min(1).max(64),
  entityId: z.string().min(1),
  fieldKey: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/),
});
export type ClearCustomFieldPayload = z.infer<typeof clearCustomFieldPayloadSchema>;

const CLEAR_CUSTOM_FIELD_REASON =
  "reads custom field definitions with an explicit tenant_id = caller tenant via raw SQL with read retry";

// clear-custom-field — removes a custom-field value from a host entity.
// Emits the customField.cleared event; MSP removes the key from the
// jsonb column (key removal, not setting it to null).
//
// Per-field fieldAccess.write gate: the caller must hold one of the defined
// roles when fieldDefinition.serializedField.fieldAccess.write is set.
// Handler-level RBAC (TenantAdmin/Member) still applies as well.
export const clearCustomFieldHandler: WriteHandlerDef = {
  name: "clear-custom-field",
  schema: clearCustomFieldPayloadSchema,
  access: { roles: DEFAULT_VALUE_WRITE_ROLES },
  description:
    "Removes the stored value of one custom field from a single host entity row after re-checking that field's per-field write roles; use it to blank a field the user emptied instead of writing a null value.",
  escapeHatch: {
    grants: ["unsafeRaw"],
    reason: CLEAR_CUSTOM_FIELD_REASON,
  },
  handler: async (event, ctx) => {
    const payload = event.payload as ClearCustomFieldPayload; // @cast-boundary engine-payload

    const accessCheck = await checkFieldAccessForWrite(
      ctx.db.unsafeRaw(),
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

    await ctx.events.unsafeAppend({
      aggregateId: payload.entityId,
      aggregateType: payload.entityName,
      type: createCustomFieldsFeature().exports.clearedEvent.name,
      payload: { fieldKey: payload.fieldKey },
    });

    return {
      isSuccess: true as const,
      data: { entityName: payload.entityName, entityId: payload.entityId },
    };
  },
};

/** Companion to createSetCustomFieldHandler: set and clear use the same roles;
 *  allowing a value to be set without allowing it to be cleared would leave
 *  access control incomplete. */
export function createClearCustomFieldHandler(
  roles: readonly string[] = DEFAULT_VALUE_WRITE_ROLES,
): WriteHandlerDef {
  return { ...clearCustomFieldHandler, access: { roles } };
}
