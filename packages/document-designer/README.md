# @cosmicdrift/kumiko-document-designer

Document designer for Kumiko: the template overview, the layout editor for the mail layout and the PDF letterhead, and the PDF template editor.

```ts
import { createTemplateResolverFeature } from "@cosmicdrift/kumiko-bundled-features/template-resolver";
import { createDocumentDesignerFeature } from "@cosmicdrift/kumiko-document-designer";
import { documentDesignerClient } from "@cosmicdrift/kumiko-document-designer/web";

// server feature list
createTemplateResolverFeature();
createDocumentDesignerFeature();

createKumikoApp({
  clientFeatures: [
    documentDesignerClient({ appLocales: ["de", "en"], pdfEditorScreenId: "pdf-template-editor" }),
  ],
});
```

## Overview and layout editor

Mount `createDocumentDesignerFeature()` after `template-resolver` (and `managed-pages` if the branding rail should link to the branding screen).

- Screens: `templates` (TenantAdmin, SystemAdmin), `platform-templates` (SystemAdmin, adds the "customised by" column), `layout-editor` (opened from the "Edit" row action of a layout).
- Navs: `document-designer:nav:templates` and `document-designer:nav:platform-templates`. `createAdminShellFeature({ includeDocumentDesigner: true })` lists them in the admin workspaces.
- `TEMPLATE_EDITOR_SCREENS` maps a template kind to the screen that edits it; adding a kind there adds the "Edit" row action.
- The MJML tab of the layout editor is shown to SystemAdmin only and only when the system layout is MJML.

## PDF template editor

`documentDesignerClient({ pdfEditorScreenId })` registers the editor as the custom screen the app declared under that id. The screen reads the template from the URL: `?slug=invoice&locale=de`.
`PdfTemplateEditor` (props `slug`, `locale`, `onLocaleChange`) can also be mounted directly.

Requirements: the `template-resolver` and `renderer-puppeteer-client` features on the server.
A SystemAdmin (via `UserRolesProvider`) edits the system template, everyone else a tenant customisation.
PDF preview uses `pdfjs-dist` in the main thread (no worker or CDN requests).
