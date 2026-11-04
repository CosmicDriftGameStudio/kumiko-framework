import type { BootRuleTable } from "./boot-rule.ts";

export const LIST_ROW_GUIDANCE_RULES = {
  hintColumnRenderer: {
    id: "list/hint-column-renderer",
    summary: "A hint column owns its cell rendering and sets no renderer.",
    fix: "Remove renderer or hint from the column.",
  },
  hintColumnDisplay: {
    id: "list/hint-column-display",
    summary: "A hint column owns its cell rendering and sets no display.",
    fix: "Remove display or hint from the column.",
  },
  linkParamsWithoutScreenField: {
    id: "list/link-params-without-screen-field",
    summary: "linkParamsField only parametrizes the linkScreenField target.",
    fix: "Set linkScreenField on the column or remove linkParamsField.",
  },
  guidanceFieldEmpty: {
    id: "list/guidance-field-empty",
    summary: "rowToneField and the hint field names are non-empty strings.",
    fix: "Name a row field or remove the option.",
  },
} as const satisfies BootRuleTable;
