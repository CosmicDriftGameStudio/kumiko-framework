import type { WriteHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { customFieldsFeature } from "../feature";

export const setCustomFieldPayloadSchema = z.object({
  entityName: z.string().min(1).max(64),
  entityId: z.string().min(1),
  fieldKey: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/),
  value: z.unknown(),
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
// **WAS DIESER HANDLER NICHT MACHT (yet)**:
//   - Validation des Werts gegen fieldDefinition-type (B2-todo: rehydriere
//     r.field.X() aus serializedField, .schema.safeParse(value))
//   - cap-counter-quota-Check
//   - field-access-check (nur fieldDefinition.fieldAccess.write-Rollen
//     dürfen setzen)
// → Diese Aspekte kommen als Folgekommits oder durch consumer-side hooks.
export const setCustomFieldHandler: WriteHandlerDef = {
  name: "set-custom-field",
  schema: setCustomFieldPayloadSchema,
  access: { roles: ["TenantAdmin", "TenantMember"] },
  handler: async (event, ctx) => {
    const payload = event.payload as SetCustomFieldPayload; // @cast-boundary engine-payload

    // Emit customField.set on host-aggregate stream. unsafeAppendEvent
    // (statt strict appendEvent) weil event-type-map keine cross-feature-
    // augmentation für diesen event-typ hat — wir nutzen den qualified
    // string-namen direkt.
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
