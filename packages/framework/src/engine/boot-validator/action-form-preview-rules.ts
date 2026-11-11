import type { BootRuleTable } from "./boot-rule.ts";

export const ACTION_FORM_PREVIEW_RULES = {
  fieldUnknown: {
    id: "action-form-preview/field-unknown",
    summary: "preview.fields names fields of the form.",
    fix: "Name an existing field of the form, or drop fields to send all of them.",
  },
  labelMissing: {
    id: "action-form-preview/label-missing",
    summary: "Every preview fact and list column has a label.",
    fix: "Add label: the i18n key of the fact or column header.",
  },
  listFieldMissing: {
    id: "action-form-preview/list-field-missing",
    summary: "preview.list names the result field of its rows and at least one column.",
    fix: "Set list.field to the array in the query result and list the columns to show.",
  },
  sectionUnknown: {
    id: "action-form-preview/section-unknown",
    summary: "preview.section names a fields section of the layout.",
    fix: "Give a layout section that id, or drop section to show the preview below the form.",
  },
  empty: {
    id: "action-form-preview/empty",
    summary: "A preview shows facts or a list.",
    fix: "Add facts or list, or remove preview.",
  },
} as const satisfies BootRuleTable;
