# @cosmicdrift/kumiko-document-designer

## 0.366.0

### Patch Changes

- 7053800: The registrar takes one object per call: r.writeHandler, r.queryHandler, r.entity, r.requires and r.hook lose their positional forms
  
  <!-- kumiko-changes
  feature: framework
  type: breaking
  title: Registrar methods take a single object, positional calls throw at registration
  detail: |
    r.writeHandler, r.queryHandler, r.entity, r.requires and r.hook now take one object. The positional overloads are gone from the types and throw when the feature is defined, with a message that points at the codemod. The throw is removed in the first release after 2026-10-29.
  
    writeHandler (queryHandler is the same shape):
      before: r.writeHandler("order:archive", schema, handler, { access });
      after:  r.writeHandler({ name: "order:archive", schema, handler, access });
  
    hook (type picks the handler shape, target is a name, a list or { allOf }):
      before: r.hook("postSave", "order", handler, { escapeHatch });
      after:  r.hook({ type: "postSave", target: "order", handler, escapeHatch });
  
    entity and requires:
      before: r.entity("order", definition, { table: ordersTable });  r.requires("auth", "tenant");
      after:  r.entity({ name: "order", ...definition, backingTable: ordersTable });  r.requires({ features: ["auth", "tenant"] });
  
    registerEntityCrud is no longer exported from @cosmicdrift/kumiko-framework/engine; call r.crud(name, entity, options) instead. The entity option { table } is now backingTable on the r.entity object and lands in the feature's entityTables, not in its entities. HookDefinition and EntityObjectDefinition are exported from @cosmicdrift/kumiko-types. Hook definitions are checked per type: validation takes no escapeHatch, phase only exists on postSave and postDelete, and { allOf } is not accepted on preSave.
  migration: Run `bun kumiko-upgrade --apply`. It rewrites every positional r.writeHandler, r.queryHandler, r.entity, r.requires, r.hook and registerEntityCrud call to the object form. Calls it cannot resolve statically (a spread argument, a registrar that is not typed as FeatureRegistrar) are listed as manual work with file and line; rewrite those by hand.
  codemod: scripts/codemod/object-form.ts
  manualAfterCodemod: true
  -->
- Updated dependencies [09d5344]
- Updated dependencies [22b7f6e]
- Updated dependencies [22b7f6e]
- Updated dependencies [a919906]
- Updated dependencies [15d76a8]
- Updated dependencies [22b7f6e]
- Updated dependencies [22b7f6e]
- Updated dependencies [22b7f6e]
- Updated dependencies [22b7f6e]
- Updated dependencies [8a7d835]
- Updated dependencies [7053800]
- Updated dependencies [3d58dea]
- Updated dependencies [49b3f10]
- Updated dependencies [5df8e3a]
- Updated dependencies [22b7f6e]
- Updated dependencies [7053800]
  - @cosmicdrift/kumiko-bundled-features@0.366.0
  - @cosmicdrift/kumiko-framework@0.366.0
  - @cosmicdrift/kumiko-types@0.366.0
  - @cosmicdrift/kumiko-renderer@0.366.0
  - @cosmicdrift/kumiko-renderer-puppeteer-client@0.366.0
  - @cosmicdrift/kumiko-renderer-web@0.366.0
  - @cosmicdrift/kumiko-headless@0.366.0

## 0.365.1

### Patch Changes

- Updated dependencies [93e1a7d]
- Updated dependencies [9a8abc9]
- Updated dependencies [34530bf]
- Updated dependencies [8633239]
- Updated dependencies [34530bf]
- Updated dependencies [34530bf]
  - @cosmicdrift/kumiko-framework@0.365.1
  - @cosmicdrift/kumiko-bundled-features@0.365.1
  - @cosmicdrift/kumiko-types@0.365.1
  - @cosmicdrift/kumiko-headless@0.365.1
  - @cosmicdrift/kumiko-renderer@0.365.1
  - @cosmicdrift/kumiko-renderer-puppeteer-client@0.365.1
  - @cosmicdrift/kumiko-renderer-web@0.365.1

## 0.365.0

### Patch Changes

- 45abe9d: The document designer names seeded mails, opens in the UI language and shows the built-in layout
  
  <!-- kumiko-changes
  feature: document-designer
  type: improvement
  title: Seeded mails show readable titles and the editor opens in the UI language
  detail: A mail template without a stored title is named by its notification label (<feature>:notify.<name>.label) in the overview and the editor header instead of its slug. The mail editor opens on the UI language, or its base language, when the template has it, and falls back to the previous choice otherwise. The layout select offers the built-in standard layout when no default layout is stored, and the preview text field shows a hint while empty.
  -->
  
  <!-- kumiko-changes
  feature: auth-email-password
  type: improvement
  title: Auth mails carry designer labels
  detail: The feature registers <feature>:feature.label and notify labels for password-reset, account-unlock, email-verification, signup-activation and invite, so the document designer lists them by name. German and Spanish ship in the locale packages.
  -->
  
  <!-- kumiko-changes
  feature: user-data-rights
  type: improvement
  title: GDPR mails carry designer labels
  detail: Feature and notify labels for export-ready, export-failed, deletion-requested and deletion-executed name the GDPR mails in the document designer.
  -->
  
  <!-- kumiko-changes
  feature: billing-foundation
  type: improvement
  title: Contract mails carry designer labels
  detail: Feature and notify labels for contract-confirmation, contract-termination-receipt and contract-termination-operator-notice name the contract mails in the document designer.
  -->
  
  <!-- kumiko-changes
  feature: waitlist
  type: improvement
  title: Waitlist mails carry designer labels
  detail: Feature and notify labels for confirmation and admin-notice name the waitlist mails in the document designer.
  -->
- 72a5c9c: Document editors report null to onEditorReady when they are destroyed
  
  <!-- kumiko-changes
  feature: template-resolver
  type: breaking
  title: onEditorReady receives null when the editor is destroyed
  detail: DocumentTiptapEditor and PlaceholderLineEditor call onEditorReady(null) on destroy, so a held handle no longer points at a destroyed editor. The callback type is (handle: DocumentEditorHandle | null) => void. The document designer drops the handle of an unmounted field, so placeholder insertion no longer targets a destroyed editor.
  migration: A custom onEditorReady callback must accept null and drop its stored handle when it receives it.
  -->
- 6070813: Layout editor no longer asks for the platform override counts after a tenant save
  
  <!-- kumiko-changes
  feature: document-designer
  type: fix
  title: Layout editor no longer asks for the platform override counts after a tenant save
  detail: Saving or resetting a layout as tenant admin refetched the tenant-overrides query, which only the platform admin may read, so every save logged a 403. The reload now refetches it only for the platform admin.
  -->
- 45abe9d: Structured mails render as a card with a brand row, a toned chip and top line, a steps block and a footer band
  
  <!-- kumiko-changes
  feature: renderer-mail-html
  type: improvement
  title: Structured mail layouts render as a card with a footer band
  detail: The structured frame now draws a rounded white card with a border on the outer background. The top line sits inside the card, the footer region goes into a grey band at the bottom of the card, and the platform line from the footer resolver sits below the card. The in-code layout uses 640 px width and #ecedea as outer background and shows the tenant logo at 28 px height beside the tenant name, or an initial tile in the accent colour when no logo is set. Mail headings carry inline sizes (h1 30 px bold) and small text renders at 13 px. Existing structured layouts change their look accordingly; mjml layouts are unchanged.
  -->
  
  <!-- kumiko-changes
  feature: renderer-mail-html
  type: improvement
  title: Mail meta headerChip, tone and footerNote
  detail: A mail template can set meta.headerChip (a chip right of the brand row), meta.tone (accent, info, success, warning, danger or neutral; colours the chip, the top line of the card and the steps block) and meta.footerNote (a line above the site and unsubscribe links in the card band). All three accept placeholders and are rendered escaped; an unknown tone falls back to the accent colour. The band links the tenant site from the branding siteUrl next to the unsubscribe link. createRendererMailHtmlFeature({ brandSuffix }) adds a word after the tenant name in the brand row.
  -->
  
  <!-- kumiko-changes
  feature: template-resolver
  type: improvement
  title: Steps block in mail and PDF templates
  detail: The document editor offers a steps block in the toolbar block menu. It stores a fixed list of stages (value=label, at most 8) and the variable that names the current stage. Mail and PDF render it as a row of bars and labels; stages up to the current one are coloured, the current label is bold. Invalid blocks are dropped by the sanitizer and render nothing. Layout regions do not offer the block.
  -->
  
  <!-- kumiko-changes
  feature: dev-server
  type: improvement
  title: composeRendererStack passes a mail brand suffix resolver
  detail: composeRendererStack({ mailBrandSuffix }) hands the resolver to createRendererMailHtmlFeature as brandSuffix.
  -->
  
  <!-- kumiko-changes
  feature: document-designer
  type: improvement
  title: Mail editor rail edits header chip, tone and footer note
  detail: The properties rail of the mail editor has a section "Kopf und Fuß" with the header chip and the footer note as placeholder lines and the tone as a select (accent, info, success, warning, danger, neutral). The values are saved in the mail meta and show in the preview right away. A tone stored as placeholder stays as its own option; the accent tone is stored as no tone. template-resolver/web exports MAIL_TONES and MailTone.
  -->
  
  <!-- kumiko-changes
  feature: renderer-puppeteer-client
  type: improvement
  title: PDF steps block uses the branding accent colour
  detail: The steps block in a PDF document is coloured with the accent colour from the tenant branding, like in mails, and falls back to #1f5468 when no branding colour is set.
  -->
- b6b75fa: Layout validation waits for a pause in typing, quick mail uploads get distinct keys, and a failed system publish still reloads the editor
  
  <!-- kumiko-changes
  feature: document-designer
  type: fix
  title: Debounced layout validation, collision-free resource keys and reload after a half-finished system publish
  detail: The layout editor sent a validate query (with an MJML compile) on every change; it now waits 400 ms after the last edit. A second upload with the same file name before the row refetch finished reused the first key; keys handed out earlier are now remembered. When a SystemAdmin saved a mail version but publishing it failed, the editor kept the old state with the error shown; it now reloads so the stored version is visible.
  -->
- Updated dependencies [eef5ff1]
- Updated dependencies [84d7f1a]
- Updated dependencies [84d7f1a]
- Updated dependencies [eef5ff1]
- Updated dependencies [cd16f29]
- Updated dependencies [84d7f1a]
- Updated dependencies [72a5c9c]
- Updated dependencies [72a5c9c]
- Updated dependencies [7aa3223]
- Updated dependencies [eef5ff1]
- Updated dependencies [84d7f1a]
- Updated dependencies [84d7f1a]
- Updated dependencies [efa6253]
- Updated dependencies [84d7f1a]
- Updated dependencies [7e1b974]
- Updated dependencies [e4ecaba]
- Updated dependencies [ec7d696]
- Updated dependencies [efa6253]
- Updated dependencies [84d7f1a]
- Updated dependencies [eef5ff1]
- Updated dependencies [efa6253]
- Updated dependencies [45abe9d]
- Updated dependencies [72a5c9c]
- Updated dependencies [72a5c9c]
- Updated dependencies [81169ec]
- Updated dependencies [84d7f1a]
- Updated dependencies [efa6253]
- Updated dependencies [fbc6938]
- Updated dependencies [5a1cdc1]
- Updated dependencies [efa6253]
- Updated dependencies [eef5ff1]
- Updated dependencies [80e2132]
- Updated dependencies [72a5c9c]
- Updated dependencies [82dc9a4]
- Updated dependencies [82dc9a4]
- Updated dependencies [eef5ff1]
- Updated dependencies [eef5ff1]
- Updated dependencies [82dc9a4]
- Updated dependencies [eef5ff1]
- Updated dependencies [82dc9a4]
- Updated dependencies [eef5ff1]
- Updated dependencies [eef5ff1]
- Updated dependencies [2a33c8d]
- Updated dependencies [eef5ff1]
- Updated dependencies [eef5ff1]
- Updated dependencies [efa6253]
- Updated dependencies [59bbd15]
- Updated dependencies [72a5c9c]
- Updated dependencies [efa6253]
- Updated dependencies [84d7f1a]
- Updated dependencies [efa6253]
- Updated dependencies [45abe9d]
- Updated dependencies [45abe9d]
- Updated dependencies [5e5d83b]
- Updated dependencies [72a5c9c]
- Updated dependencies [72a5c9c]
- Updated dependencies [a546703]
- Updated dependencies [84d7f1a]
- Updated dependencies [72a5c9c]
- Updated dependencies [72a5c9c]
- Updated dependencies [efa6253]
- Updated dependencies [5c276e6]
- Updated dependencies [21c5cbc]
- Updated dependencies [82dc9a4]
- Updated dependencies [fbc6938]
- Updated dependencies [efa6253]
- Updated dependencies [72a5c9c]
- Updated dependencies [efa6253]
- Updated dependencies [b6b75fa]
- Updated dependencies [b6b75fa]
- Updated dependencies [b6b75fa]
- Updated dependencies [b6b75fa]
- Updated dependencies [72a5c9c]
- Updated dependencies [0f8bff5]
- Updated dependencies [84d7f1a]
- Updated dependencies [067aa7b]
- Updated dependencies [fbc6938]
- Updated dependencies [efa6253]
- Updated dependencies [efa6253]
- Updated dependencies [eef5ff1]
- Updated dependencies [84d7f1a]
- Updated dependencies [84d7f1a]
- Updated dependencies [cd16f29]
- Updated dependencies [72a5c9c]
- Updated dependencies [2a33c8d]
- Updated dependencies [eef5ff1]
- Updated dependencies [72a5c9c]
- Updated dependencies [efa6253]
- Updated dependencies [84d7f1a]
- Updated dependencies [82dc9a4]
- Updated dependencies [eef5ff1]
- Updated dependencies [82dc9a4]
- Updated dependencies [72a5c9c]
  - @cosmicdrift/kumiko-bundled-features@0.365.0
  - @cosmicdrift/kumiko-framework@0.365.0
  - @cosmicdrift/kumiko-types@0.365.0
  - @cosmicdrift/kumiko-renderer@0.365.0
  - @cosmicdrift/kumiko-renderer-puppeteer-client@0.365.0
  - @cosmicdrift/kumiko-renderer-web@0.365.0
  - @cosmicdrift/kumiko-headless@0.365.0

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
