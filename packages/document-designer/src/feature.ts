import {
  access,
  defineFeature,
  type FeatureDefinition,
  i18nKey,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  DOCUMENT_DESIGNER_FEATURE,
  LAYOUT_EDITOR_SCREEN_ID,
  PLATFORM_TEMPLATES_NAV_ID,
  PLATFORM_TEMPLATES_SCREEN_ID,
  TEMPLATES_NAV_ID,
  TEMPLATES_SCREEN_ID,
} from "./constants.js";
import { DOCUMENT_DESIGNER_I18N } from "./i18n.js";
import { TEMPLATE_FACETS, templateColumns, templateRowActions } from "./list-definition.js";

const OVERVIEW_QUERY = "template-resolver:query:overview";
const TENANT_ROLES = ["TenantAdmin", "SystemAdmin"] as const;

export function createDocumentDesignerFeature(): FeatureDefinition {
  return defineFeature(DOCUMENT_DESIGNER_FEATURE, (r) => {
    r.describe(
      "Template overview and layout editor: lists the mail, PDF and layout templates of a tenant (platform admins see the system templates and how many tenants customised each) and edits the mail layout and the PDF letterhead in the browser. Mount after template-resolver and, for the branding rail, managed-pages. Client: `documentDesignerClient()`; admin-shell lists the navs with `includeDocumentDesigner`.",
    );
    r.uiHints({
      displayLabel: "Documents · Template Designer",
      category: "content",
      recommended: false,
    });
    r.requires("template-resolver");

    r.translations({ keys: DOCUMENT_DESIGNER_I18N });

    r.screen({
      id: TEMPLATES_SCREEN_ID,
      type: "projectionList",
      query: OVERVIEW_QUERY,
      columns: templateColumns({ platform: false }),
      facets: [...TEMPLATE_FACETS],
      rowActions: templateRowActions(),
      searchable: true,
      searchPlaceholder: i18nKey("documentDesigner.search"),
      pagination: "pages",
      defaultSort: { field: "modifiedAt", dir: "desc" },
      access: { roles: access.roles(...TENANT_ROLES) },
    });
    r.nav({
      id: TEMPLATES_NAV_ID,
      label: "document-designer:nav.templates",
      icon: "file",
      screen: `${DOCUMENT_DESIGNER_FEATURE}:screen:${TEMPLATES_SCREEN_ID}`,
      access: { roles: access.roles(...TENANT_ROLES) },
      order: 15,
    });

    r.screen({
      id: PLATFORM_TEMPLATES_SCREEN_ID,
      type: "projectionList",
      query: OVERVIEW_QUERY,
      columns: templateColumns({ platform: true }),
      facets: [...TEMPLATE_FACETS],
      rowActions: templateRowActions(),
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

    // kumiko-lint-ignore app-feature-structure Board-5 layout editor (region editors, branding rail, MJML tab) has no declarative screen type
    r.screen({
      id: LAYOUT_EDITOR_SCREEN_ID,
      type: "custom",
      renderer: { react: { __component: LAYOUT_EDITOR_SCREEN_ID } },
      description: "documentDesigner.screen.layoutEditor.description",
      dormant: true,
      access: { roles: access.roles(...TENANT_ROLES) },
    });
  });
}
