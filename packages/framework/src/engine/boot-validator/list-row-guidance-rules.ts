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
  hintColumnLink: {
    id: "list/hint-column-link",
    summary:
      "A hint column owns its cell rendering and sets no linkScreenField, linkParamsField, refEntity or badgeToneField.",
    fix: "Remove the link or badge option, or move the hint to its own column.",
  },
  buttonColumnWithoutLink: {
    id: "list/button-column-without-link",
    summary:
      'A column with display "button" has a link (linkScreenField or refEntity) to draw as the button.',
    fix: 'Set linkScreenField or refEntity on the column, or remove display: "button".',
  },
  linkParamsWithoutScreenField: {
    id: "list/link-params-without-screen-field",
    summary: "linkParamsField only parametrizes the linkScreenField target.",
    fix: "Set linkScreenField on the column or remove linkParamsField.",
  },
  guidanceFieldEmpty: {
    id: "list/guidance-field-empty",
    summary: "rowToneField, linkParamsField and the hint field names are non-empty strings.",
    fix: "Name a row field or remove the option.",
  },
  rowDecorationQueryEmpty: {
    id: "list/row-decoration-query-empty",
    summary: "rowDecoration.query is a non-empty query QN.",
    fix: "Name the decoration query or remove rowDecoration.",
  },
  rowDecorationIdsMissing: {
    id: "list/row-decoration-ids-missing",
    summary:
      "The rowDecoration query's input schema declares `ids`, the row ids the list sends with every call.",
    fix: "Add `ids: z.array(z.string())` to the decoration query's schema.",
  },
} as const satisfies BootRuleTable;
