import type { BootRuleTable } from "./boot-rule.ts";

export const PII_RULES = {
  multipleSubjectAnnotations: {
    id: "pii/multiple-subject-annotations",
    summary: "A field carries at most one subject-key annotation.",
    fix: "Keep a single personal annotation on the field.",
  },
  textWithoutPersonalStance: {
    id: "pii/text-without-personal-stance",
    summary: "Every text and longText field declares whether it holds personal data.",
    fix: "Declare a personal stance, or personal: false with a reason stating why the value is not personal data.",
  },
  plaintextUserReference: {
    id: "pii/plaintext-user-reference",
    summary: "A reference to the user entity is never plaintext.",
    fix: 'Use the default reference field or personal: "ref" instead of personal: false.',
  },
  lookupableNonText: {
    id: "pii/lookupable-non-text",
    summary: "Blind-index lookups apply to text fields only.",
    fix: 'Use a text field or set find: "none".',
  },
  lookupableWithoutSubject: {
    id: "pii/lookupable-without-subject",
    summary: "A blind-index lookup requires a subject annotation on the field.",
    fix: 'Add a personal annotation or set find: "none".',
  },
  sensitiveWithoutCiphertext: {
    id: "pii/sensitive-without-ciphertext",
    summary: "A sensitive field is stored as ciphertext at rest.",
    fix: "Add a subject annotation or encrypted: true.",
  },
  writeOnlyEmbeddedSubField: {
    id: "pii/write-only-embedded-sub-field",
    summary: "writeOnly is only supported on top-level text fields, not on embedded sub-fields.",
    fix: "Remove writeOnly from the sub-field or declare it on a top-level text field.",
  },
  writeOnlyNonText: {
    id: "pii/write-only-non-text",
    summary: "writeOnly applies to text fields only.",
    fix: "Use a text field or remove writeOnly.",
  },
  writeOnlyWithoutSensitive: {
    id: "pii/write-only-without-sensitive",
    summary: "A writeOnly field is also sensitive.",
    fix: 'Declare the field with find: "secret".',
  },
  writeOnlyConflictingFlag: {
    id: "pii/write-only-conflicting-flag",
    summary: "A writeOnly field cannot be defaulted, searched, sorted, filtered or looked up.",
    fix: "Remove either writeOnly or the conflicting flag.",
  },
  subjectKeySortable: {
    id: "pii/subject-key-sortable",
    summary: "A field with a subject-key annotation is not sortable, its column is ciphertext.",
    fix: 'Drop sortable, use find: "exact" for equality lookups, or keep the field plaintext.',
  },
  sensitiveSearchable: {
    id: "pii/sensitive-searchable",
    summary: "A sensitive field is never searchable.",
    fix: "Drop searchable, or add writeOnly to never return the value.",
  },
  personalJsonbFlag: {
    id: "pii/personal-jsonb-flag",
    summary:
      "A personal jsonb field cannot be sortable, filterable, searchable or lookupable, its value is a ciphertext string.",
    fix: "Remove the flag or the personal annotation.",
  },
  personalJsonbIndex: {
    id: "pii/personal-jsonb-index",
    summary: "A personal jsonb field is not part of an entity index.",
    fix: "Drop the index or the personal annotation.",
  },
  personalJsonbCustomFields: {
    id: "pii/personal-jsonb-custom-fields",
    summary: "The custom-fields jsonb column cannot carry a personal annotation.",
    fix: "Drop the personal annotation.",
  },
  personalOfMissingOwnerName: {
    id: "pii/personal-of-missing-owner-name",
    summary: "personal: { of } names the owner field.",
    fix: 'Pass the name of the owner field: personal: { of: "<ownerField>" }.',
  },
  personalOfUnknownOwner: {
    id: "pii/personal-of-unknown-owner",
    summary: "The owner field named by personal: { of } exists on the entity.",
    fix: "Point personal.of at an existing field of the entity.",
  },
  personalOfOwnerType: {
    id: "pii/personal-of-owner-type",
    summary: "The owner field named by personal: { of } is a reference or text field.",
    fix: "Use a reference or text field as owner.",
  },
  personalOfInvalidWhenAbsent: {
    id: "pii/personal-of-invalid-when-absent",
    summary: 'personal.whenAbsent is either "tenant" or "self".',
    fix: 'Remove whenAbsent or set it to "tenant" or "self".',
  },
  personalOfOptionalOwner: {
    id: "pii/personal-of-optional-owner",
    summary: "An optional owner field of personal: { of } declares a whenAbsent fallback.",
    fix: 'Set whenAbsent to "tenant" or "self", or make the owner field required.',
  },
  retentionUnknownReference: {
    id: "retention/unknown-reference",
    summary: "retention.reference names an existing field or a framework timestamp.",
    fix: "Point retention.reference at an existing field or a framework-managed timestamp.",
  },
} as const satisfies BootRuleTable;
