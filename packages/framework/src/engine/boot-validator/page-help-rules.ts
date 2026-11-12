import type { BootRuleTable } from "./boot-rule.ts";

export const PAGE_HELP_RULES = {
  statusFieldInvalid: {
    id: "page-help/status-field-invalid",
    summary:
      "pageHelp names a select field of an existing entity, bare for the own feature or `<feature>:<entity>` for another one (entity is required on a projectionDetail; a relatedList defaults to its section entity).",
    fix: "Point pageHelp.statusField at a select field and pageHelp.entity at an existing entity (`<feature>:<entity>` for a foreign one).",
  },
  optionHelpMissing: {
    id: "page-help/option-help-missing",
    summary:
      "Every option of the pageHelp field has a `:help` translation, in the feature that owns the entity, in each locale its option label has.",
    fix: "Add `<option label key>:help` via r.translations(...) in the owning feature for the listed options and locales.",
  },
} as const satisfies BootRuleTable;
