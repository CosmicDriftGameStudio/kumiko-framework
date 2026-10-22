import * as z from "zod";

// Domain events for custom-field values. customField.set and .cleared live
// on the host aggregate stream, alongside the host entity's own events.
//
// The event's aggregate type is the host entity name (for example, "property"),
// and its aggregate ID is the host entity row ID (for example, property-uuid).
// This ensures customFields-MSPs consume only events for their wired entities,
// filtered by aggregate-type match in each consumer-side-MSP registration.

export const customFieldSetSchema = z.object({
  fieldKey: z.string().min(1).max(64),
  // Every set carries its value (custom fields hold no PII) — replay
  // reproduces the projection fully. Stays optional at the type layer only
  // because z.unknown() is inherently optional; the apply side treats
  // `value === undefined` as an anomaly and warns.
  value: z.unknown().optional(),
});
export type CustomFieldSetPayload = z.infer<typeof customFieldSetSchema>;

export const customFieldClearedSchema = z.object({
  fieldKey: z.string().min(1).max(64),
});
export type CustomFieldClearedPayload = z.infer<typeof customFieldClearedSchema>;
