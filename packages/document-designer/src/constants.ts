// @runtime client
// Names shared by the server feature and the client plugin. Plain data, no imports.
export const DOCUMENT_DESIGNER_FEATURE = "document-designer" as const;

export const TEMPLATES_SCREEN_ID = "templates" as const;
export const PLATFORM_TEMPLATES_SCREEN_ID = "platform-templates" as const;
export const LAYOUT_EDITOR_SCREEN_ID = "layout-editor" as const;
export const PDF_TEMPLATE_EDITOR_SCREEN_ID = "pdf-template-editor" as const;

export const TEMPLATES_NAV_ID = "templates" as const;
export const PLATFORM_TEMPLATES_NAV_ID = "platform-templates" as const;

export const BRANDING_SCREEN_QN = "managed-pages:screen:branding-settings" as const;
export const BRANDING_QUERY_QN = "managed-pages:query:branding" as const;

export const DEFAULT_LAYOUT_SLUG = "default" as const;

export type TemplateEditorKind = "mail" | "document-pdf" | "mail-layout" | "pdf-layout";

// Short screen id per template kind. A kind without an entry gets no "Edit" row action.
// The mail editor adds `mail` here and declares its screen in this feature, because the
// boot validator only accepts navigate targets in the same feature.
export const TEMPLATE_EDITOR_SCREENS: Partial<Record<TemplateEditorKind, string>> = {
  "document-pdf": PDF_TEMPLATE_EDITOR_SCREEN_ID,
  "mail-layout": LAYOUT_EDITOR_SCREEN_ID,
  "pdf-layout": LAYOUT_EDITOR_SCREEN_ID,
};

export const DocumentDesignerCells = {
  title: "document-designer-title-cell",
  kind: "document-designer-kind-cell",
  origin: "document-designer-origin-cell",
  locales: "document-designer-locales-cell",
  status: "document-designer-status-cell",
  usedBy: "document-designer-used-by-cell",
  modifiedAt: "document-designer-modified-cell",
  overriddenBy: "document-designer-overridden-by-cell",
} as const;

export const DEFAULT_TEMPLATE_LOCALES: readonly string[] = ["de", "en"];
