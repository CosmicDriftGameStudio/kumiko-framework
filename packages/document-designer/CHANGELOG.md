# @cosmicdrift/kumiko-document-designer

## 0.364.0

### Minor Changes

- 68078ee: Editors and overview show an open draft beside the active version
  
  The editor header shows the served version (Active vN) next to the open draft (Draft vM), fed by the active field of find-by-id and layout-source; the template overview shows the draftVersion badge under the status of an active row.
  
  <!-- kumiko-changes
  feature: document-designer
  type: improvement
  title: Editors and overview show an open draft beside the active version
  -->
- c181b3f: Document designer editors follow the approved board
  
  Mail-layout templates accept appearance meta (width, font, outer background, accent line, button style) that the mail renderer applies, and the layout-source query returns it. The layout editor uses the shared editor shell with one paper and one shared toolbar (`DocumentContentEditor` gains `toolbarHost`). Mail and PDF editors share frame, info bar, rails and footer.
  
  The unused `sender` key of mail template meta is gone from the editor; stored rows that still carry it are read without it, so they stay editable.
  
  Invalid template meta now reports per-field messages (`templateResolver.errors.template.meta.<field>.required|invalid`) instead of the parser text; the editors show them at the field. The `tenant-overrides` query additionally returns one row per customising tenant (name, status, version, changed at/by) and, with `diffTenantId`, the diff to the system version. A language without a version shows an empty state in the mail editor instead of a disabled editor.
  
  The `compileDocumentBody` option `resourceImageMaxWidthPx` caps resource images in mails (180 px). The `send-test` command takes `prefixSubject` (default true) to skip the `[TEST]` subject prefix, the template preview returns `mailLayout` (slug, scope, version of the layout used), and `RenderedMail` carries the layout ref.
  
  <!-- kumiko-changes
  feature: document-designer
  type: improvement
  title: Document designer editors follow the approved board
  -->

### Patch Changes

- 8e81d73: PDF editor saves only the margins that are set; preview and error handling fixes
  
  <!-- kumiko-changes
  feature: document-designer
  type: fix
  title: PDF editor keeps unset margins unset, frees old PDF previews, and shows reset and diff errors
  detail: Setting one margin no longer stores the other three as 15 mm, so the layout's header and footer margins still apply to them. The PDF preview no longer re-renders pages or stacks text layers on re-render and destroys the previous document. A failed reset to the system version shows an error banner in the PDF and mail editors, and a failing diff query shows an error state with retry instead of loading forever. The canvas reserves the footer margin like the renderer. Page formats, orientations and default margins now come from template-resolver (new exports PDF_ORIENTATIONS, PDF_DEFAULT_MARGIN_MM, PDF_HEADER_MARGIN_MM, PDF_FOOTER_MARGIN_MM, PdfOrientation).
  -->
- 15039ce: The layout editor counts the users of a layout on the server instead of from a page of 200 templates
  
  <!-- kumiko-changes
  feature: template-resolver
  type: fix
  title: template-resolver:query:overview accepts layoutSlug to list only the mails and PDFs using that layout
  detail: The optional layoutSlug payload field keeps only documents whose layout slug matches; total counts the filtered rows. Without it the response is unchanged.
  -->
  
  <!-- kumiko-changes
  feature: document-designer
  type: fix
  title: Layout editor shows the real number of mails or PDFs using a layout
  detail: The editor asks the overview for the users of one layout (kind and layoutSlug filter) and takes the count from total, so a tenant with more than 200 templates no longer sees a too low usage number.
  -->
- 55f003d: Test isolation for the search payload warn spy and the mail editor placeholder rail
  
  <!-- kumiko-changes
  feature: framework
  type: fix
  title: Unit tests no longer leak a console.warn spy into later files
  detail: The search payload precedence tests spy on console.warn per test and restore it, so later files in the same --no-isolate worker start with the real console.warn. The mail editor missing-language test waits for the placeholder rail instead of reading it before the validate query settled.
  -->
- Updated dependencies [15039ce]
- Updated dependencies [8e81d73]
- Updated dependencies [a0dcd31]
- Updated dependencies [fd5009a]
- Updated dependencies [8e81d73]
- Updated dependencies [e9b032f]
- Updated dependencies [15039ce]
- Updated dependencies [cfbffba]
- Updated dependencies [15039ce]
- Updated dependencies [8e81d73]
- Updated dependencies [6b1567e]
- Updated dependencies [2b255c2]
- Updated dependencies [15039ce]
- Updated dependencies [8e81d73]
- Updated dependencies [92a9c52]
- Updated dependencies [fd5009a]
- Updated dependencies [8be3807]
- Updated dependencies [15039ce]
- Updated dependencies [8e81d73]
- Updated dependencies [c181b3f]
- Updated dependencies [8e81d73]
- Updated dependencies [fd5009a]
- Updated dependencies [8e81d73]
- Updated dependencies [8e81d73]
- Updated dependencies [8e81d73]
- Updated dependencies [15039ce]
- Updated dependencies [fd5009a]
- Updated dependencies [fd5009a]
- Updated dependencies [8e81d73]
- Updated dependencies [fd5009a]
- Updated dependencies [15039ce]
- Updated dependencies [8e81d73]
- Updated dependencies [8e81d73]
- Updated dependencies [8e81d73]
- Updated dependencies [b13c0d4]
- Updated dependencies [fd5009a]
- Updated dependencies [dfb2523]
- Updated dependencies [8fb6aa6]
- Updated dependencies [7482ee2]
- Updated dependencies [8e81d73]
- Updated dependencies [8e81d73]
- Updated dependencies [fd5009a]
- Updated dependencies [5a39305]
- Updated dependencies [8e81d73]
- Updated dependencies [8e81d73]
- Updated dependencies [fd5009a]
- Updated dependencies [7482ee2]
- Updated dependencies [f1b4367]
- Updated dependencies [fd5009a]
- Updated dependencies [15039ce]
- Updated dependencies [15039ce]
- Updated dependencies [15039ce]
- Updated dependencies [15039ce]
- Updated dependencies [e9b032f]
- Updated dependencies [15039ce]
- Updated dependencies [8be3807]
- Updated dependencies [22f40e1]
- Updated dependencies [5a2bea5]
- Updated dependencies [7482ee2]
- Updated dependencies [7482ee2]
- Updated dependencies [7482ee2]
- Updated dependencies [7482ee2]
- Updated dependencies [7482ee2]
- Updated dependencies [7482ee2]
- Updated dependencies [7482ee2]
- Updated dependencies [7482ee2]
- Updated dependencies [7482ee2]
- Updated dependencies [7482ee2]
- Updated dependencies [7482ee2]
- Updated dependencies [7482ee2]
- Updated dependencies [8e81d73]
- Updated dependencies [baf641a]
- Updated dependencies [8e81d73]
- Updated dependencies [92a9c52]
- Updated dependencies [15039ce]
- Updated dependencies [fd5009a]
- Updated dependencies [8e81d73]
- Updated dependencies [8be3807]
- Updated dependencies [8e81d73]
- Updated dependencies [15039ce]
- Updated dependencies [68078ee]
- Updated dependencies [15039ce]
- Updated dependencies [15039ce]
- Updated dependencies [b5a6395]
- Updated dependencies [fd5009a]
- Updated dependencies [55f003d]
- Updated dependencies [8e81d73]
- Updated dependencies [fd5009a]
- Updated dependencies [8e81d73]
- Updated dependencies [8e81d73]
  - @cosmicdrift/kumiko-bundled-features@0.364.0
  - @cosmicdrift/kumiko-framework@0.364.0
  - @cosmicdrift/kumiko-types@0.364.0
  - @cosmicdrift/kumiko-renderer-puppeteer-client@0.364.0
  - @cosmicdrift/kumiko-renderer@0.364.0
  - @cosmicdrift/kumiko-renderer-web@0.364.0
  - @cosmicdrift/kumiko-headless@0.364.0

## 0.363.0

### Minor Changes

- f16183c: Mail editor screen with live preview and test mail

  <!-- kumiko-changes
  feature: document-designer
  type: improvement
  title: Mail templates open in a mail editor with preview and test mail
  detail: The "Edit" row action of a mail template opens the new mail-editor screen: subject, preview text and content with placeholders from the notification, logo and file attachments, PDF-template attachments, layout and category, sandboxed preview (HTML or text, desktop or 375 px), test mail to the signed-in user and the audit-based version list. PreviewRecordPickerProvider is an optional slot for a "pick a record" action in the preview.
  -->

- 3c6b3da: Template overview and layout editor

  <!-- kumiko-changes
  feature: template-resolver
  type: improvement
  title: Overview and layout-source queries for the template designer
  detail: template-resolver:query:overview lists the mail, PDF and layout templates of the caller's tenant grouped by slug and kind (effective origin, locales, status, versions, layout slug, last change and the notifications that use it) and template-resolver:query:layout-source returns the header, signature and footer regions of a mail or PDF layout plus the locale a save has to use; a SystemAdmin also receives the MJML source of the system layout. The usage lookup is the exported collectTemplateUsage.
  -->

  <!-- kumiko-changes
  feature: managed-pages
  type: improvement
  title: Branding screen edits the logo file and readBranding returns logoFile
  detail: The branding settings screen has a logo upload for managed-pages:config:branding-logo-file, and readBranding and the branding query include logoFile next to logoUrl. The template resource errors template_resource_too_large and template_resource_unsupported_image have German and Spanish texts.
  -->

  <!-- kumiko-changes
  feature: admin-shell
  type: improvement
  title: includeDocumentDesigner lists the template navs in the admin workspaces
  detail: With includeDocumentDesigner, the tenant workspace shows document-designer:nav:templates and the platform workspace document-designer:nav:platform-templates. The option requires the document-designer feature and defaults to false.
  -->

  <!-- kumiko-changes
  feature: document-designer
  type: improvement
  title: Template overview, layout editor and an options object for documentDesignerClient
  detail: The package gains the server feature createDocumentDesignerFeature with the templates and platform-templates overviews and the layout-editor screen. documentDesignerClient now takes an options object instead of a screen id, and appLocales sets the languages column of the overview. The feature declares the pdf-template-editor screen (PDF_TEMPLATE_EDITOR_SCREEN_ID) and PDF rows open the PDF editor.
  -->

- 0a79504: Add the PDF template editor screen (`@cosmicdrift/kumiko-document-designer/web`): placeholder panel, page canvas with layout header and footer, page settings, validation footer and a pdf.js preview. The template-resolver document editor gains an `align` block, labelled placeholder chips, a repeat-table bar and an `onEditorReady` handle; `template-resolver/web` exports the qualified names; `renderer-puppeteer-client` exports `./qualified-names`; renderer-web's stylesheet scans the new package.

  <!-- kumiko-changes
  feature: document-designer
  type: improvement
  title: New package with the PDF template editor screen
  detail: "@cosmicdrift/kumiko-document-designer/web" exports documentDesignerClient(screenId), PdfTemplateEditorScreen, PdfTemplateEditor and documentDesignerTranslations. The screen takes the template from the URL (?slug=...&locale=...), edits the system template for a SystemAdmin and a tenant customisation for everyone else, and previews the printed PDF with pdf.js. template-resolver/web additionally exports DocumentEditorHandle, TemplateResolverQueries, TemplateResolverHandlers and TemplateResolverErrors.
  -->

  <!-- kumiko-changes
  feature: renderer-web
  type: improvement
  title: uploadFileRef uploads a file to the stack and returns its FileRef id
  detail: uploadFileRef(file, target?) posts to /api/files with the CSRF header and returns the new FileRef id; it throws FileUploadFailedError carrying the server message when the endpoint sent one. FileUploadInput uses it with unchanged behaviour.
  -->

### Patch Changes

- Updated dependencies [9120f65]
- Updated dependencies [ef689d8]
- Updated dependencies [9120f65]
- Updated dependencies [045f886]
- Updated dependencies [a12e094]
- Updated dependencies [9120f65]
- Updated dependencies [b9a146d]
- Updated dependencies [9120f65]
- Updated dependencies [58452ae]
- Updated dependencies [ef689d8]
- Updated dependencies [a12e094]
- Updated dependencies [3c6b3da]
- Updated dependencies [09a4aa2]
- Updated dependencies [b022cca]
- Updated dependencies [fcd6eb4]
- Updated dependencies [2972bc2]
- Updated dependencies [2972bc2]
- Updated dependencies [2972bc2]
- Updated dependencies [ef689d8]
- Updated dependencies [4a748c3]
- Updated dependencies [0a79504]
- Updated dependencies [0a79504]
- Updated dependencies [2972bc2]
- Updated dependencies [f7da271]
- Updated dependencies [9120f65]
- Updated dependencies [7ed530a]
- Updated dependencies [d35e9a0]
- Updated dependencies [549a6f6]
- Updated dependencies [f3fe91e]
- Updated dependencies [3c6b3da]
- Updated dependencies [2972bc2]
- Updated dependencies [3c6b3da]
- Updated dependencies [46b83b8]
- Updated dependencies [cbed66e]
- Updated dependencies [366d89f]
- Updated dependencies [a12e094]
- Updated dependencies [9120f65]
- Updated dependencies [9120f65]
  - @cosmicdrift/kumiko-bundled-features@0.363.0
  - @cosmicdrift/kumiko-framework@0.363.0
  - @cosmicdrift/kumiko-types@0.363.0
  - @cosmicdrift/kumiko-renderer-web@0.363.0
  - @cosmicdrift/kumiko-renderer-puppeteer-client@0.363.0
  - @cosmicdrift/kumiko-renderer@0.363.0
  - @cosmicdrift/kumiko-headless@0.363.0
