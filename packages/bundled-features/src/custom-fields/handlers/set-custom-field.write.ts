import type { WriteHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import { failNotFound, failUnprocessable } from "@cosmicdrift/kumiko-framework/errors";
import { z } from "zod";
import { DEFAULT_VALUE_WRITE_ROLES } from "../constants";
import { customFieldsFeature } from "../feature";
import { fieldWriteAccessDeniedRoles, loadFieldDefinition } from "../lib/field-access";
import { buildCustomFieldValueSchema } from "../lib/value-schema";

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

// set-custom-field — schreibt einen Custom-Field-Wert auf eine host-entity.
//
// **ES-Option-B**: emittiert customField.set-Event auf dem host-aggregate
// stream (aggregateType = host-entity-name, aggregateId = host-entity-id).
// Last-Wins-Semantik: customField.set wird OHNE expectedVersion appended,
// concurrent writes auf gleiches Field gehen beide durch (Plan-Doc v2
// Concurrency-Tabelle).
//
// **Write-Pfad (Single-Fetch)** — eine fieldDefinition-Ladung, drei Gates:
//   1. Definition fehlt → 404.
//   2. field-access (T1.5b): fieldAccess.write-Rollen müssen intersecten, sonst
//      403/422. Handler-level RBAC (TenantAdmin/Member) bleibt zusätzlich.
//   3. Value-Validation (Builder-Reuse): der Wert wird gegen das aus
//      serializedField rehydrierte fieldToZod-Schema geparst. Type-Mismatch →
//      422, KEIN Event entsteht (Projection bleibt typed — Plan-Doc
//      Stammfeld-Identität). `value: null` ODER `value: undefined` auf einem
//      typisierten Feld sind Type-Mismatches → 422; zum Entfernen eines Werts
//      dient clear-custom-field.
//
// Scope: ECHTE type-only Validation. value-schema.ts strippt `required`,
// `maxLength`, `format` und `default` aus dem serializedField bevor fieldToZod
// daraus ein Schema baut — wir prüfen nur die Type-Shape. Required-on-set,
// Default-Application und Length-/Format-Enforcement bleiben out-of-scope
// (Plan-Doc "Stammfeld-Identität" listet sie als eigene Zeilen).
export const setCustomFieldHandler: WriteHandlerDef = {
  name: "set-custom-field",
  schema: setCustomFieldPayloadSchema,
  access: { roles: DEFAULT_VALUE_WRITE_ROLES },
  handler: async (event, ctx) => {
    const payload = event.payload as SetCustomFieldPayload; // @cast-boundary engine-payload

    const loaded = await loadFieldDefinition(
      ctx.db,
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

    // Emit customField.set on host-aggregate stream. unsafeAppendEvent
    // (statt strict appendEvent) weil event-type-map keine cross-feature-
    // augmentation für diesen event-typ hat — wir nutzen den qualified
    // string-namen direkt. Der Wert steht IMMER im Event (custom fields
    // tragen keine PII, #972) — Replay reproduziert die Projection voll.
    await ctx.unsafeAppendEvent({
      aggregateId: payload.entityId,
      aggregateType: payload.entityName,
      type: customFieldsFeature.exports.setEvent.name,
      payload: { fieldKey: payload.fieldKey, value: payload.value },
    });

    return {
      isSuccess: true as const,
      data: { entityName: payload.entityName, entityId: payload.entityId },
    };
  },
};

/** Value-Write mit App-Rollen statt der Bundle-Defaults — Apps mit eigenem
 *  Rollen-Vokabular (z.B. "Admin"/"Editor") reichen ihre Rollen über
 *  createCustomFieldsFeature({ valueWriteRoles }) hierher durch. */
export function createSetCustomFieldHandler(
  roles: readonly string[] = DEFAULT_VALUE_WRITE_ROLES,
): WriteHandlerDef {
  return { ...setCustomFieldHandler, access: { roles } };
}
