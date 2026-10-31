import type { BootRuleTable } from "./boot-rule.ts";

export const HANDLER_FIELD_REFERENCE_RULES = {
  invalidReference: {
    id: "handler-schema/invalid-references",
    summary:
      "A references meta on an input field is an entity name, feature:entity or { entity, by? }.",
    fix: 'Use "<entity>", "<feature>:<entity>" or { entity, by? }.',
  },
  unknownReferenceEntity: {
    id: "handler-schema/unknown-references-entity",
    summary: "The entity a references meta names is registered.",
    fix: 'Use "<entity>" for this feature or "<feature>:<entity>" for another one.',
  },
  unknownReferenceBy: {
    id: "handler-schema/unknown-references-by",
    summary: "The by field of a references meta is a field of the referenced entity.",
    fix: "Use an existing field of that entity for by.",
  },
  zodWalkLimit: {
    id: "handler-schema/zod-walk-limit",
    summary: "A handler schema has a finite node count when walked.",
    fix: "Hoist a z.lazy() getter that returns a new schema on every call into a constant.",
  },
} as const satisfies BootRuleTable;
