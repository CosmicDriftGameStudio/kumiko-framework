import type { BootRuleTable } from "./boot-rule.ts";

export const ENTITY_LIST_RULES = {
  searchableFalse: {
    id: "entity-list/searchable-false",
    summary: "Operator lists are searchable unless they are on the searchable-false whitelist.",
    fix: "Set searchable: true or add the screen id to the whitelist.",
  },
  defaultSortRequired: {
    id: "entity-list/default-sort-required",
    summary: "A list with active search or filterable fields declares a defaultSort.",
    fix: "Set defaultSort: { field, direction } on the screen.",
  },
  defaultSortNotListed: {
    id: "entity-list/default-sort-not-listed",
    summary: "defaultSort.field is one of the listed columns.",
    fix: "Pick a field from columns or add it there.",
  },
  defaultSortNotSortable: {
    id: "entity-list/default-sort-not-sortable",
    summary: "The defaultSort column is sortable.",
    fix: "Mark the field sortable or pick another defaultSort field.",
  },
  detailWithoutNavigate: {
    id: "entity-list/detail-without-navigate",
    summary: "A list whose entity has a detail screen offers a navigate row action.",
    fix: 'Add a navigate rowAction with id "view" or "edit".',
  },
  unknownColumn: {
    id: "entity-list/unknown-column",
    summary:
      "Every column without a label names an entity field, derived field or row-meta column.",
    fix: "Fix the column field name or give the column a label.",
  },
} as const satisfies BootRuleTable;
