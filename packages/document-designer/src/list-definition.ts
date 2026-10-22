import { TemplateResolverHandlers } from "@cosmicdrift/kumiko-bundled-features/template-resolver";
import {
  i18nKey,
  type ListColumnSpec,
  type ListFacetSpec,
  type RowAction,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  DocumentDesignerCells,
  PLATFORM_LAYOUT_EDITOR_SCREEN_ID,
  TEMPLATE_EDITOR_SCREENS,
  type TemplateEditorKind,
} from "./web/constants.ts";

function cell(component: string): { readonly react: { readonly __component: string } } {
  return { react: { __component: component } };
}

const BASE_COLUMNS: readonly ListColumnSpec[] = [
  {
    field: "title",
    label: i18nKey("documentDesigner.col.template"),
    renderer: cell(DocumentDesignerCells.title),
  },
  {
    field: "kindGroup",
    label: i18nKey("documentDesigner.col.kind"),
    renderer: cell(DocumentDesignerCells.kind),
  },
  {
    field: "origin",
    label: i18nKey("documentDesigner.col.origin"),
    renderer: cell(DocumentDesignerCells.origin),
  },
  {
    field: "locales",
    label: i18nKey("documentDesigner.col.locales"),
    hideOnNarrow: true,
    renderer: cell(DocumentDesignerCells.locales),
  },
  {
    field: "status",
    label: i18nKey("documentDesigner.col.status"),
    renderer: cell(DocumentDesignerCells.status),
  },
  {
    field: "usedBy",
    label: i18nKey("documentDesigner.col.usedBy"),
    hideOnNarrow: true,
    renderer: cell(DocumentDesignerCells.usedBy),
  },
  {
    field: "modifiedAt",
    label: i18nKey("documentDesigner.col.modifiedAt"),
    hideOnNarrow: true,
    renderer: cell(DocumentDesignerCells.modifiedAt),
  },
];

const OVERRIDDEN_BY_COLUMN: ListColumnSpec = {
  field: "overriddenBy",
  label: i18nKey("documentDesigner.col.overriddenBy"),
  virtual: true,
  hideOnNarrow: true,
  renderer: cell(DocumentDesignerCells.overriddenBy),
};

export function templateColumns(options: { readonly platform: boolean }): ListColumnSpec[] {
  return options.platform ? [...BASE_COLUMNS, OVERRIDDEN_BY_COLUMN] : [...BASE_COLUMNS];
}

export const TEMPLATE_FACETS: readonly ListFacetSpec[] = [
  {
    field: "kindGroup",
    type: "select",
    label: i18nKey("documentDesigner.facet.kind"),
    options: [
      { value: "mail", label: i18nKey("documentDesigner.kind.mail") },
      { value: "pdf", label: i18nKey("documentDesigner.kind.pdf") },
      { value: "layout", label: i18nKey("documentDesigner.kind.layout") },
    ],
  },
  {
    field: "origin",
    type: "select",
    label: i18nKey("documentDesigner.facet.origin"),
    options: [
      { value: "system", label: i18nKey("documentDesigner.source.system") },
      { value: "tenant", label: i18nKey("documentDesigner.source.tenant") },
    ],
  },
  {
    field: "status",
    type: "select",
    label: i18nKey("documentDesigner.facet.status"),
    options: [
      { value: "active", label: i18nKey("documentDesigner.status.active") },
      { value: "draft", label: i18nKey("documentDesigner.status.draft") },
      { value: "archived", label: i18nKey("documentDesigner.status.archived") },
    ],
  },
];

function isLayoutKind(kind: TemplateEditorKind): boolean {
  return kind === "mail-layout" || kind === "pdf-layout";
}

const EDITABLE_KINDS: readonly TemplateEditorKind[] = [
  "mail",
  "document-pdf",
  "mail-layout",
  "pdf-layout",
];

const RESET_LOCKED_OVERRIDE_ACTION: RowAction = {
  id: "reset-locked-override",
  label: i18nKey("documentDesigner.action.resetLockedOverride"),
  handler: TemplateResolverHandlers.resetToSystem,
  payload: { map: { id: "lockedOverrideId" } },
  confirm: i18nKey("documentDesigner.action.resetLockedOverride.confirm"),
  confirmLabel: i18nKey("documentDesigner.action.resetLockedOverride.confirmLabel"),
  style: "danger",
  visible: { field: "canResetLockedOverride", eq: true },
};

// The screen the row is opened from fixes the layout scope: the platform overview edits the system
// layout, the tenant overview always the tenant's own, even for a SystemAdmin on a system-origin row.
export function templateRowActions(options: { readonly platform: boolean }): RowAction[] {
  const editActions = EDITABLE_KINDS.flatMap((kind): RowAction[] => {
    const screen =
      options.platform && isLayoutKind(kind)
        ? PLATFORM_LAYOUT_EDITOR_SCREEN_ID
        : TEMPLATE_EDITOR_SCREENS[kind];
    if (screen === undefined) return [];
    return [
      {
        kind: "navigate",
        id: `edit-${kind}`,
        label: i18nKey("documentDesigner.action.edit"),
        screen,
        params: { pick: ["slug", "kind"] },
        visible: { field: "kind", eq: kind },
      },
    ];
  });
  return [...editActions, RESET_LOCKED_OVERRIDE_ACTION];
}
