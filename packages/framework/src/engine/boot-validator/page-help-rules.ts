import type { BootRuleTable } from "./boot-rule.ts";

export const PAGE_HELP_RULES = {
  statusFieldInvalid: {
    id: "page-help/status-field-invalid",
    summary:
      "Every status section of a pageHelp names a select field of an existing entity, bare for the own feature or `<feature>:<entity>` for another one (entity is required on a projectionDetail; a relatedList defaults to its section entity).",
    fix: "Point the status section's field at a select field and its entity at an existing entity (`<feature>:<entity>` for a foreign one).",
  },
  optionHelpMissing: {
    id: "page-help/option-help-missing",
    summary:
      "Every option of the pageHelp field has a `:help` translation, in the feature that owns the entity, in each locale its option label has.",
    fix: "Add `<option label key>:help` via r.translations(...) in the owning feature for the listed options and locales.",
  },
  unsupportedSite: {
    id: "page-help/unsupported-site",
    summary:
      "A relatedList's pageHelp only joins the help of a projectionDetail; on a relatedList of an entityEdit it would be ignored.",
    fix: "Declare pageHelp on the projectionDetail or entityList instead.",
  },
} as const satisfies BootRuleTable;
