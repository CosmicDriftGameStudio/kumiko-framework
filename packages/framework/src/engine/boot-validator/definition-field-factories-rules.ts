import type { BootRuleTable } from "./boot-rule.ts";

export const DEFINITION_FIELD_FACTORY_RULES = {
  personalRecordOwnerWhenAbsent: {
    id: "field/personal-record-owner-when-absent",
    summary: 'personal: { of: "id" } sets no whenAbsent.',
    fix: "Remove whenAbsent from the record-owned stance.",
  },
  textStanceMissing: {
    id: "field/text-stance-missing",
    summary: "Text field factories declare an explicit personal-data stance.",
    fix: "Pass one of the stance options listed in the message.",
  },
  userReferenceNotPersonal: {
    id: "field/user-reference-not-personal",
    summary: "A reference to the user entity is personal data.",
    fix: 'Drop personal: false or use { personal: "ref" }.',
  },
  decimalPrecisionScaleInvalid: {
    id: "field/decimal-precision-scale-invalid",
    summary: "Decimal precision is at least 1 and scale lies between 0 and precision.",
    fix: "Use integers with 1 <= precision and 0 <= scale <= precision.",
  },
} as const satisfies BootRuleTable;
