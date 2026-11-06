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
      "A hint column owns its cell rendering and sets no linkScreenField, linkParamsField, refEntity, badgeToneField or badgeDot.",
    fix: "Remove the link or badge option, or move the hint to its own column.",
  },
  hintColumnEmptyPlaceholder: {
    id: "list/hint-column-empty-placeholder",
    summary: "A hint column shows hint.emptyLabel for an empty value and sets no emptyPlaceholder.",
    fix: "Remove emptyPlaceholder, or name the empty sentence with hint.emptyLabel.",
  },
  buttonColumnWithoutLink: {
    id: "list/button-column-without-link",
    summary:
      'A column with display "button" has a link (linkScreenField or refEntity) to draw as the button.',
    fix: 'Set linkScreenField or refEntity on the column, or remove display: "button".',
  },
  buttonColumnInListTable: {
    id: "list/button-column-in-list-table",
    summary:
      'display "button" is drawn only in dashboard list panels; entityList and projectionList tables (RenderList) keep a row button as a rowAction.',
    fix: 'Declare the button as a rowAction with display: "button" or remove display: "button" from the column.',
  },
  narrowOnlyConflict: {
    id: "list/narrow-only-conflict",
    summary: "A showOnNarrowOnly column sets none of hideOnNarrow: true, hidden: true or pinned.",
    fix: "Remove the conflicting option or showOnNarrowOnly.",
  },
  narrowDetailFieldWithoutDetailField: {
    id: "list/narrow-detail-field-without-detail-field",
    summary: "hint.narrowDetailField replaces hint.detailField below sm, so it needs detailField.",
    fix: "Set hint.detailField or remove narrowDetailField.",
  },
  reasonOptionWithoutReasonField: {
    id: "list/reason-option-without-reason-field",
    summary:
      "hint.reasonOpenField and hint.reasonTitleField shape the reason text, so they need reasonField.",
    fix: "Set hint.reasonField or remove reasonOpenField and reasonTitleField.",
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
    fix: "Add `ids: z.array(z.string())` to the decoration query's schema; `.max(...)` must cover at least the list page size; the list asks in batches of the first page size.",
  },
} as const satisfies BootRuleTable;
