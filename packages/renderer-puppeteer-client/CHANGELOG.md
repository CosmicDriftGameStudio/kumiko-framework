# @cosmicdrift/kumiko-renderer-puppeteer-client

## 0.363.0

### Minor Changes

- b022cca: Document PDFs are rendered from stored templates by renderer-puppeteer-client

  <!-- kumiko-changes
  feature: renderer-foundation
  type: breaking
  title: document-pdf requests name a template, the response carries fileName
  detail: The document-pdf payload is { slug, locale, variables } instead of ready HTML in content. The response has a fileName, RendererContext gets an optional filesForTenant (file access per tenant) and RendererError has the new code unavailable for a renderer backend that cannot be reached.
  migration: |
    Callers that sent `payload: { content }` switch to a document-pdf template and pass slug, locale and variables (money-horse credit-schedule-pdf follows in #621); renderer-pdf callers pass slug and locale too. The enterprise package @cosmicdriftgamestudio/kumiko-renderer-puppeteer-client no longer builds against these types and is replaced by @cosmicdrift/kumiko-renderer-puppeteer-client.
  -->

  <!-- kumiko-changes
  feature: renderer-puppeteer-client
  type: breaking
  title: renders document-pdf from templates, adds renderAndStorePdf, the rendered-pdf entity and puppeteer-status
  detail: The plugin resolves the document-pdf template and its pdf-layout (header, signature, footer), embeds every image as a data URI and sends finished HTML to the puppeteer-service. renderAndStorePdf(ctx, { slug, locale, variables, attachTo? }) stores the PDF as a file and a rendered-pdf record with the template and layout version. The puppeteer-status query reports whether the service answers; while it does not, rendering fails with PuppeteerUnavailableError (HTTP 503, puppeteer_unavailable). The feature adds the table rendered_pdfs.
  migration: |
    Call renderAndStorePdf(ctx, { slug, locale, variables, attachTo? }) from a write handler; no escape hatch or rendererDb is needed because the tenant db also reads system templates and files. Apps that mount renderer-puppeteer-client need a schema migration for rendered_pdfs (`kumiko schema generate`). PUPPETEER_SERVICE_URL and PUPPETEER_AUTH_TOKEN stay as before. image-snapshot requests are unchanged.
  -->

  <!-- kumiko-changes
  feature: delivery
  type: improvement
  title: Mails can attach a PDF that is rendered from a document template when the mail is sent
  detail: notify data.attachments accepts { kind: "rendered-pdf", templateSlug, variables, fileName, locale? }. The send job renders the PDF through the document-pdf renderer, so the job payload carries the variables (at most 64000 bytes as JSON), not the bytes. Variables are stored in the job payload, so keep personal data out of them or accept that retention.
  -->

  <!-- kumiko-changes
  feature: channel-email
  type: improvement
  title: Email channel sends rendered-pdf attachments
  detail: The channel resolves rendered-pdf entries from notify data next to file entries; without a locale the message locale is used. A render failure fails the send job, so the retry runs it again.
  -->

  <!-- kumiko-changes
  feature: renderer-mail-html
  type: improvement
  title: Images in layout regions, exported document-kit helpers
  detail: A mail layout region can contain images (data-resource) that are sent as inline attachments. The document helpers (createDocumentHandlebars, compileDocumentSource, readDocumentFormat, readTenantName, resolveResourceFileRefs, collectRegionResourceKeys, mergeResourceFileRefs) are exported, so other renderers format documents the same way.
  -->

  <!-- kumiko-changes
  feature: renderer-puppeteer-client
  type: improvement
  title: The service performs no network fetches
  detail: Only data:, about: and blob: requests are allowed, everything else is aborted. The client embeds all resources as data URIs, so there is no DNS rebinding and no reachable node IP or kubelet. Margins accept 0.
  -->

  <!-- kumiko-changes
  feature: renderer-foundation
  type: improvement
  title: renderer plugins can preview a document
  detail: RendererPlugin gets the optional capability previewDocument(req, ctx), which returns the filled-in body and layout regions without calling the print service. template-resolver:query:preview with kind document-pdf uses it, so the editor shows replaced placeholders and the resource and required-placeholder checks; without such a plugin the preview keeps returning the body and raw layout.
  -->

  <!-- kumiko-changes
  feature: template-resolver
  type: fix
  title: Preview uses the examples of a stored or draft variable schema
  detail: A template's variableSchema kept only type and required, label and example were dropped, so the preview showed [name] instead of the declared example. The schema now keeps label and example, for mail and document previews.
  -->

- 0a79504: Server side of the PDF editor: PDF preview, page setup and text alignment

  <!-- kumiko-changes
  feature: renderer-puppeteer-client
  type: improvement
  title: Query preview-pdf prints a document draft to a real PDF
  detail: renderer-puppeteer-client:query:preview-pdf takes { slug, locale, content, meta, variableSchema? } and returns { fileName, pdfBase64, pageCount, sizeBytes, durationMs }. The draft passes the same write rules as a save, is printed with the sample values of its variable schema through the puppeteer-service and nothing is stored. It is limited to 60 calls per user and hour and fails with puppeteer_unavailable (HTTP 503) while the service does not answer. Access is TenantAdmin and SystemAdmin.
  -->

  <!-- kumiko-changes
  feature: template-resolver
  type: improvement
  title: PDF meta gets orientation, printBackground and layoutHeaderFooter; paragraphs and headings get data-align
  detail: The document-pdf meta accepts orientation (portrait or landscape), printBackground (default true) and layoutHeaderFooter (false prints without the layout header and footer). Paragraphs and headings carry textAlign (left, center, right, justify), serialized as data-align and kept by the sanitizer only with these four values. New exports are evaluateDocumentDraft, localeSchema, DOCUMENT_TEXT_ALIGNMENTS and DocumentTextAlign; compileDocumentBodyToHandlebars accepts alignmentAsInlineStyle.
  -->

  <!-- kumiko-changes
  feature: renderer-foundation
  type: improvement
  title: PdfOptions has landscape
  detail: The document-pdf options gain landscape, which the puppeteer-service passes to Chromium.
  -->

  <!-- kumiko-changes
  feature: renderer-mail-html
  type: improvement
  title: Text alignment of paragraphs and headings is sent as an inline style
  detail: A paragraph or heading with data-align is rendered with an inline text-align, because mail clients ignore document CSS.
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

- f7da271: The puppeteer-client renderer plugin moves from kumiko-enterprise into the framework under the `@cosmicdrift` scope; the API is unchanged.

  <!-- kumiko-changes
  feature: renderer-puppeteer-client
  type: breaking
  title: Package moved to the framework under the @cosmicdrift scope
  detail: Renamed from @cosmicdriftgamestudio/kumiko-renderer-puppeteer-client (GitHub Packages, kumiko-enterprise) to @cosmicdrift/kumiko-renderer-puppeteer-client on npmjs; the API is unchanged.
  migration: |
    Replace @cosmicdriftgamestudio/kumiko-renderer-puppeteer-client with @cosmicdrift/kumiko-renderer-puppeteer-client in package.json and in every import; install from npmjs instead of GitHub Packages.
  -->

### Patch Changes

- a12e094: dispatcher-live validates server envelopes with Zod

  <!-- kumiko-changes
  feature: dispatcher-live
  type: improvement
  title: dispatcher-live validates server envelopes with Zod
  detail: Query, write, batch and stream responses are parsed against Zod schemas for the envelope (isSuccess, error, failedIndex, results); the data payload stays typed by the caller. A malformed envelope now yields the network_error fallback ("unexpected response shape") instead of passing wrongly typed fields through; bare gate errors ({ error } from csrf, origin, auth or rate limits) keep their code, and a missing i18nKey defaults to errors.unknown; a malformed SSE error frame yields stream_error, and failing batch items get httpStatus filled from the response like top-level errors. renderer-web types CSS custom properties on React's CSSProperties instead of casting style objects.
  -->

- 3c6b3da: Layouts resolve across locales

  <!-- kumiko-changes
  feature: template-resolver
  type: improvement
  title: resolveLayout finds a layout in any locale
  detail: TemplateResolverApi gains resolveLayout({ tenantId, slug, kind, locale }) for mail-layout and pdf-layout. It looks at the tenant first (requested locale, then the fallback locale, then any active locale) and then at the system layouts the same way, ignoring draft and archived rows. A layout saved by the layout editor under one locale is therefore found for every locale. The template preview uses it for the PDF layout.
  -->

  <!-- kumiko-changes
  feature: renderer-mail-html
  type: fix
  title: Mails use a tenant layout stored under another locale
  detail: The mail renderer resolves its layout with resolveLayout, so a tenant layout saved in en no longer leaves German mails without the tenant branding.
  -->

  <!-- kumiko-changes
  feature: renderer-puppeteer-client
  type: fix
  title: PDFs use a tenant layout stored under another locale
  detail: The document PDF renderer resolves its letterhead with resolveLayout, so a tenant pdf-layout saved under one locale applies to every document locale.
  -->

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
- Updated dependencies [3c6b3da]
- Updated dependencies [09a4aa2]
- Updated dependencies [0a79504]
- Updated dependencies [b022cca]
- Updated dependencies [fcd6eb4]
- Updated dependencies [2972bc2]
- Updated dependencies [ef689d8]
- Updated dependencies [4a748c3]
- Updated dependencies [0a79504]
- Updated dependencies [0a79504]
- Updated dependencies [2972bc2]
- Updated dependencies [2972bc2]
- Updated dependencies [f7da271]
- Updated dependencies [6b8d89b]
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
  - @cosmicdrift/kumiko-renderer-mail-html@0.363.0
