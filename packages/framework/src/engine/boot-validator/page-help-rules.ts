import type { BootRuleTable } from "./boot-rule.ts";

export const PAGE_HELP_RULES = {
  statusFieldInvalid: {
    id: "page-help/status-field-invalid",
    summary:
      "pageHelp names a select field of an entity of the same feature (entity is required on a projectionDetail).",
    fix: "Point pageHelp.statusField at a select field and pageHelp.entity at an entity of the feature.",
  },
  optionHelpMissing: {
    id: "page-help/option-help-missing",
    summary:
      "Every option of the pageHelp field has a `:help` translation in each locale its option label has.",
    fix: "Add `<option label key>:help` via r.translations(...) for the listed options and locales.",
  },
} as const satisfies BootRuleTable;
