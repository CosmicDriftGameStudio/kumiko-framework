import { z } from "zod";

// Domain-Events für custom-field-VALUES. customField.set + .cleared leben
// auf der host-aggregate stream (Plan-Doc v2 ES-Option-B: customField-Events
// auf demselben Stream wie die host-entity's eigene Events).
//
// Aggregate-Type im Event ist der host-entity-name (z.B. "property"),
// aggregate-id ist die host-entity-row-id (z.B. property-uuid). So konsumieren
// die customFields-MSPs nur die Events ihrer wired-entities (filtered via
// aggregate-type-match an der jeweiligen consumer-side-MSP-Registration).

export const customFieldSetSchema = z.object({
  fieldKey: z.string().min(1).max(64),
  // Optional: a `sensitive`-field set persists a VALUE-LESS event — the value is
  // self-projected into the host row by the write handler and must never enter
  // the immutable log. Non-sensitive sets always carry the value.
  value: z.unknown().optional(),
  // Explicit protocol marker (527/1) — `value === undefined` alone is also a
  // valid-looking "clear" shape; `_sensitive` names the reason so a future
  // reader can't mistake one for the other. Optional so historical events
  // (persisted before this field existed) still parse: apply-side readers
  // keep `value === undefined` as their actual branch condition.
  _sensitive: z.literal(true).optional(),
});
export type CustomFieldSetPayload = z.infer<typeof customFieldSetSchema>;

export const customFieldClearedSchema = z.object({
  fieldKey: z.string().min(1).max(64),
});
export type CustomFieldClearedPayload = z.infer<typeof customFieldClearedSchema>;
