import type { BootRuleTable } from "./boot-rule.ts";

export const LIST_SCREEN_RULES = {
  listScreenIdUnresolved: {
    id: "list/screen-id-unresolved",
    summary: "listScreenId names a mounted screen.",
    fix: "Fix the listScreenId or mount the list screen.",
  },
  screenNoNavEntry: {
    id: "list/screen-unreachable",
    summary: "A screen without a nav entry has a resolvable list, or is marked dormant.",
    fix: "Declare listScreenId, add a standalone r.nav() pointing at it, or set dormant: true.",
  },
  relatedReadOnlyWithRowInteraction: {
    id: "list/related-read-only-with-row-interaction",
    summary: "A readOnly relatedList section declares no rowClick or rowActions.",
    fix: "Remove readOnly or the row interaction.",
  },
  relatedRowClickNoDetail: {
    id: "list/related-row-click-no-detail",
    summary: "A relatedList rowClick entity target has a screen declaring detailFor for it.",
    fix: "Add detailFor to the screen that shows the entity.",
  },
  emptyStateActionParams: {
    id: "list/empty-state-action-params",
    summary:
      "Empty-state actions set no params, because an empty list has no row to read them from.",
    fix: "Remove the params.",
  },
  relatedToolbarVisibleWhen: {
    id: "list/related-toolbar-visible-when",
    summary: "relatedList toolbarActions use visible instead of visibleWhen.",
    fix: "Use visible, a condition on the enclosing record.",
  },
  columnSortableInert: {
    id: "list/column-sortable-inert",
    summary: "A column only sets sortable where the screen type honors it.",
    fix: "Remove sortable from the column.",
  },
  columnRendererReactNotObject: {
    id: "list/column-renderer-react-not-object",
    summary: "A column renderer's react branch is an object.",
    fix: 'Use { react: { __component: "Name" } }.',
  },
  columnRendererComponentInvalid: {
    id: "list/column-renderer-component-invalid",
    summary: "A column renderer's react.__component is a non-empty string.",
    fix: "Set react.__component to the name of a client columnRenderers entry.",
  },
  enumOptionTonesInvalid: {
    id: "list/enum-option-tones-invalid",
    summary: "enumOption column tones are known select option tones.",
    fix: "Use only the allowed tones (SELECT_OPTION_TONES).",
  },
  refTargetFeatureNotMounted: {
    id: "list/ref-target-feature-not-mounted",
    summary: "An entity reference target belongs to a mounted feature.",
    fix: "Mount the feature and declare it in r.requires({ features }).",
  },
  refTargetEntityUnknown: {
    id: "list/ref-target-entity-unknown",
    summary: "An entity reference target resolves to a registered entity.",
    fix: "Name an entity the target feature registers.",
  },
  facetDuplicate: {
    id: "list/facet-duplicate",
    summary: "Each facet field is declared once.",
    fix: "Declare each facet field once.",
  },
  facetUnknownColumn: {
    id: "list/facet-unknown-column",
    summary: "A non-reference facet names a declared column.",
    fix: "Name a declared column or add the column.",
  },
  facetSelectNoOptions: {
    id: "list/facet-select-no-options",
    summary: "A select facet declares at least one option.",
    fix: "Declare at least one option.",
  },
  facetQueryUnregistered: {
    id: "list/facet-query-unregistered",
    summary: "A reference facet loads its options from a registered query handler.",
    fix: "Register the entity's list handler (defineEntityListHandler).",
  },
} as const satisfies BootRuleTable;
