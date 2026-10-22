import {
  access,
  defineFeature,
  type FeatureDefinition,
  i18nKey,
  type RoleAccessRule,
} from "@cosmicdrift/kumiko-framework/engine";
import { TEMPLATE_FACETS, templateColumns, templateRowActions } from "./list-definition.ts";
import {
  DOCUMENT_DESIGNER_FEATURE,
  LAYOUT_EDITOR_SCREEN_ID,
  MAIL_EDITOR_SCREEN_ID,
  PDF_TEMPLATE_EDITOR_SCREEN_ID,
  PLATFORM_LAYOUT_EDITOR_SCREEN_ID,
  PLATFORM_TEMPLATES_NAV_ID,
  PLATFORM_TEMPLATES_SCREEN_ID,
  TEMPLATES_NAV_ID,
  TEMPLATES_SCREEN_ID,
} from "./web/constants.ts";
import { DOCUMENT_DESIGNER_I18N } from "./web/i18n.ts";

const OVERVIEW_QUERY = "template-resolver:query:overview";

export type DocumentDesignerOptions = {
  /** Roles besides SystemAdmin that see the tenant overview and the editors. Pass `templateEditAccess(tenantEditable)` of the template-resolver mount so the screens match the templates a tenant may edit. */
  readonly access?: RoleAccessRule;
};

export function createDocumentDesignerFeature(
  options: DocumentDesignerOptions = {},
): FeatureDefinition {
  const editorRoles = [...new Set(["SystemAdmin", ...(options.access?.roles ?? [])])];
  return defineFeature(DOCUMENT_DESIGNER_FEATURE, (r) => {
    r.describe(
      "Template overview and layout editor: lists the mail, PDF and layout templates of a tenant (platform admins see the system templates and how many tenants customised each) and edits the mail layout and the PDF letterhead in the browser. Mount after template-resolver and, for the branding rail, managed-pages. Client: `documentDesignerClient()`; admin-shell lists the navs with `includeDocumentDesigner`. The tenant overview and the editors are for SystemAdmin only; the `access` option adds roles (normally `templateEditAccess(tenantEditable)` of the template-resolver mount), and the server still enforces per template which of them may save.",
    );
    r.uiHints({
      displayLabel: "Documents · Template Designer",
      category: "content",
      recommended: false,
    });
    r.requires({ features: ["template-resolver"] });

    r.translations({ keys: DOCUMENT_DESIGNER_I18N });

    r.screen({
      id: TEMPLATES_SCREEN_ID,
      type: "projectionList",
      query: OVERVIEW_QUERY,
      columns: templateColumns({ platform: false }),
      facets: [...TEMPLATE_FACETS],
      rowActions: templateRowActions({ platform: false }),
      searchable: true,
      searchPlaceholder: i18nKey("documentDesigner.search"),
      pagination: "pages",
      defaultSort: { field: "modifiedAt", dir: "desc" },
      access: { roles: access.roles(...editorRoles) },
    });
    r.nav({
      id: TEMPLATES_NAV_ID,
      label: "document-designer:nav.templates",
      icon: "file",
      screen: `${DOCUMENT_DESIGNER_FEATURE}:screen:${TEMPLATES_SCREEN_ID}`,
      access: { roles: access.roles(...editorRoles) },
      order: 15,
    });

    r.screen({
      id: PLATFORM_TEMPLATES_SCREEN_ID,
      type: "projectionList",
      query: OVERVIEW_QUERY,
      columns: templateColumns({ platform: true }),
      facets: [...TEMPLATE_FACETS],
      rowActions: templateRowActions({ platform: true }),
      searchable: true,
      searchPlaceholder: i18nKey("documentDesigner.search"),
      pagination: "pages",
      defaultSort: { field: "modifiedAt", dir: "desc" },
      access: { roles: access.systemAdmin },
    });
    r.nav({
      id: PLATFORM_TEMPLATES_NAV_ID,
      label: "document-designer:nav.platformTemplates",
      icon: "file",
      screen: `${DOCUMENT_DESIGNER_FEATURE}:screen:${PLATFORM_TEMPLATES_SCREEN_ID}`,
      access: { roles: access.systemAdmin },
      order: 15,
    });

    r.screen({
      id: LAYOUT_EDITOR_SCREEN_ID,
      type: "custom",
      renderer: { react: { __component: LAYOUT_EDITOR_SCREEN_ID } },
      description: "documentDesigner.screen.layoutEditor.description",
      dormant: true,
      access: { roles: access.roles(...editorRoles) },
    });

    r.screen({
      id: PLATFORM_LAYOUT_EDITOR_SCREEN_ID,
      type: "custom",
      renderer: { react: { __component: PLATFORM_LAYOUT_EDITOR_SCREEN_ID } },
      description: "documentDesigner.screen.layoutEditor.description",
      dormant: true,
      access: { roles: access.systemAdmin },
    });

    r.screen({
      id: PDF_TEMPLATE_EDITOR_SCREEN_ID,
      type: "custom",
      renderer: { react: { __component: PDF_TEMPLATE_EDITOR_SCREEN_ID } },
      description:
        "Editor for one PDF template: edit the body, print a preview through the print service, review tenant customisations and export the template as a bundle.",
      dormant: true,
      access: { roles: access.roles(...editorRoles) },
    });

    // kumiko-lint-ignore app-feature-structure Board-2/3 mail editor (placeholder rail, chip editors, live preview, test mail) has no declarative screen type
    r.screen({
      id: MAIL_EDITOR_SCREEN_ID,
      type: "custom",
      renderer: { react: { __component: MAIL_EDITOR_SCREEN_ID } },
      description: "documentDesigner.screen.mailEditor.description",
      dormant: true,
      access: { roles: access.roles(...editorRoles) },
    });
  });
}
