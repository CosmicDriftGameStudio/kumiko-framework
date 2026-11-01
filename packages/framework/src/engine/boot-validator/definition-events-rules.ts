import type { BootRuleTable } from "./boot-rule.ts";

export const DEFINITION_EVENT_RULES = {
  piiOwnerNotString: {
    id: "event/pii-owner-not-string",
    summary: "A PII owner field of an event payload is a string.",
    fix: 'Use a string owner field or declare whenAbsent ("tenant", "self" or "plaintext").',
  },
  piiOwnerNullable: {
    id: "event/pii-owner-nullable",
    summary: "A nullable PII owner field of an event declares whenAbsent.",
    fix: 'Declare whenAbsent as "tenant", "self" or "plaintext".',
  },
  piiFieldNotInSchema: {
    id: "event/pii-field-not-in-schema",
    summary: "Event piiFields reference fields of the payload schema.",
    fix: "Name an existing payload field.",
  },
  piiSelfOwner: {
    id: "event/pii-self-owner",
    summary: "An event PII field is not its own owner field.",
    fix: "Point the owner at a separate user id field.",
  },
  piiOwnerIsId: {
    id: "event/pii-owner-is-id",
    summary: 'Event PII fields do not use "id" as owner field.',
    fix: 'Use personal: "self" for record-owned event fields.',
  },
  piiStanceMissing: {
    id: "event/pii-stance-missing",
    summary: "Events declare an explicit PII stance.",
    fix: 'Pass piiFields with owned fields or piiFields: "none".',
  },
  piiStanceEmpty: {
    id: "event/pii-stance-empty",
    summary: "An empty piiFields object is not a stance.",
    fix: 'Use piiFields: "none" for payloads without personal data.',
  },
  versionInvalid: {
    id: "event/version-invalid",
    summary: "Event version is a positive integer.",
    fix: "Set version to an integer of 1 or higher.",
  },
} as const satisfies BootRuleTable;
