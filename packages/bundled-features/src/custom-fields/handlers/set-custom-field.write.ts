import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { failNotFound, failUnprocessable } from "@cosmicdrift/kumiko-framework/errors";
import * as z from "zod";
import { parentRowIsVisible } from "../../shared/index.ts";
import { createCustomFieldsFeature } from "../feature.ts";
import { isCustomFieldsHost } from "../lib/custom-fields-host.ts";
import { fieldWriteAccessDeniedRoles, loadFieldDefinition } from "../lib/field-access.ts";
import { buildCustomFieldValueSchema } from "../lib/value-schema.ts";
import { DEFAULT_VALUE_WRITE_ROLES } from "../web/constants.ts";

export const setCustomFieldPayloadSchema = z.object({
  entityName: z.string().min(1).max(64),
  entityId: z.string().min(1),
  fieldKey: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/),
  // z.unknown() is implicitly optional; reject a missing value here (clearing is
  // clear-custom-field's job) so the projection never binds JSON.stringify(undefined).
  value: z
    .unknown()
    .refine((v) => v !== undefined, "value is required (use clear-custom-field to remove a value)"),
});
export type SetCustomFieldPayload = z.infer<typeof setCustomFieldPayloadSchema>;

const SET_CUSTOM_FIELD_REASON =
  "reads custom field definitions of the caller tenant and the system tenant via raw SQL with read retry";

// set-custom-field — writes a custom-field value to a host entity.
//
// Emits a customField.set event on the host-aggregate
// stream (aggregateType = host-entity-name, aggregateId = host-entity-id).
// Last-wins semantics: customField.set is appended WITHOUT expectedVersion,
// so concurrent writes to the same field both succeed.
//
// **Write path (single fetch)** — one fieldDefinition load, three gates:
//   1. Definition missing → 404.
//   2. field-access: fieldAccess.write roles must intersect, otherwise
//      403/422. Handler-level RBAC (TenantAdmin/Member) also applies.
//   3. Value validation (builder reuse): the value is parsed against the
//      fieldToZod schema rehydrated from serializedField. Type mismatch →
//      422, NO event is created (the projection remains typed). `value: null`
//      OR `value: undefined` on a typed field are type mismatches → 422; use
//      clear-custom-field to remove a value.
//
// Scope: TRUE type-only validation. value-schema.ts strips `required`,
// `maxLength`, `format`, and `default` from serializedField before building
// a schema from fieldToZod — we check only the type shape. Required-on-set,
// default application, and length/format enforcement remain out of scope.
/** Value writes use app roles instead of the bundle defaults — apps with a
 *  custom role vocabulary (e.g. "Admin"/"Editor") pass their roles here via
 *  createCustomFieldsFeature({ valueWriteRoles }). */
export function createSetCustomFieldHandler(roles: readonly string[] = DEFAULT_VALUE_WRITE_ROLES) {
  return defineWriteHandler({
    name: "set-custom-field",
    schema: setCustomFieldPayloadSchema,
    access: { roles },
    description:
      "Stores one custom-field value on a single host entity row after validating it against the field definition's declared type and per-field write roles; use it to save what a user entered into a custom field.",
    escapeHatch: {
      grants: ["unsafeRaw"],
      reason: SET_CUSTOM_FIELD_REASON,
    },
    handler: async (event, ctx) => {
      const payload = event.payload;
      if (!isCustomFieldsHost(ctx.registry, payload.entityName)) {
        return failUnprocessable("custom_fields_entity_not_wired", {
          entityName: payload.entityName,
        });
      }

      const hostStreamVersion = await ctx.events.streamVersion(payload.entityId);
      if (
        !(await parentRowIsVisible(
          ctx.registry,
          payload.entityName,
          payload.entityId,
          event.user,
          ctx.db,
        ))
      ) {
        return failNotFound(payload.entityName, payload.entityId);
      }

      const loaded = await loadFieldDefinition(
        ctx.db.unsafeRawAllTenants(),
        event.user.tenantId,
        payload.entityName,
        payload.fieldKey,
      );
      if (!loaded.found) {
        return failNotFound("fieldDefinition", payload.fieldKey);
      }
      if (loaded.field === null) {
        return failUnprocessable("field_definition_corrupt", { fieldKey: payload.fieldKey });
      }

      const deniedRoles = fieldWriteAccessDeniedRoles(loaded.field, event.user.roles);
      if (deniedRoles) {
        return failUnprocessable("field_access_denied", {
          fieldKey: payload.fieldKey,
          requiredRoles: deniedRoles,
        });
      }

      const valueSchema = buildCustomFieldValueSchema(loaded.field);
      if (valueSchema) {
        const parsed = valueSchema.safeParse(payload.value);
        if (!parsed.success) {
          return failUnprocessable("custom_field_value_invalid", {
            fieldKey: payload.fieldKey,
            fieldType: loaded.field?.type,
            issues: parsed.error.issues.map((i) => i.message),
          });
        }
      }

      // Emit customField.set on the host-aggregate stream. unsafeAppendEvent
      // is used instead of strict appendEvent because event-type-map has no
      // cross-feature augmentation for this event type; the qualified string
      // name is used directly. The value is ALWAYS included in the event
      // (custom fields carry no PII), so replay fully reproduces the projection.
      await ctx.events.unsafeAppend({
        aggregateId: payload.entityId,
        aggregateType: payload.entityName,
        type: createCustomFieldsFeature().exports.setEvent.name,
        payload: { fieldKey: payload.fieldKey, value: payload.value },
        expectedVersion: hostStreamVersion,
      });

      return {
        isSuccess: true as const,
        data: { entityName: payload.entityName, entityId: payload.entityId },
      };
    },
  });
}
