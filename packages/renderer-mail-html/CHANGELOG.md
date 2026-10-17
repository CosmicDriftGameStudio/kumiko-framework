# @cosmicdrift/kumiko-renderer-mail-html

## 0.365.0

### Patch Changes

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
- 45abe9d: Mails carry the tenant logo, the accent colour and a platform footer a tenant layout cannot remove
  
  <!-- kumiko-changes
  feature: renderer-mail-html
  type: improvement
  title: createRendererMailHtmlFeature takes a footer resolver for imprint, privacy and platform line
  detail: createRendererMailHtmlFeature({ footer }) resolves a footer per mail from locale and renderer context: an optional text line plus imprint and privacy links. The renderer appends it below every layout, the in-code one, mjml layouts and structured tenant layouts, so a tenant cannot edit or delete it. Values are escaped and only http(s) and mailto links are kept. The imprint URL also fills the {{imprint}} system placeholder, and a layout region that already links {{imprint}} or {{unsubscribeUrl}} is not doubled. The unsubscribe link is labelled in the mail language (de, en, es, English otherwise). Without a resolver only the unsubscribe link is added, as before.
  -->
  
  <!-- kumiko-changes
  feature: renderer-mail-html
  type: improvement
  title: Without a stored layout mails use the tenant branding logo and accent colour
  detail: When no tenant or system layout exists, the renderer no longer falls back to a bare MJML frame. It renders the structured frame with the branding logo in the header (or the tenant name when no logo is set), the accent line and buttons in the branding accent colour, and the platform footer. Layout HTML now carries lang from the mail locale instead of lang="und".
  -->
  
  <!-- kumiko-changes
  feature: template-resolver
  type: fix
  title: A paragraph or heading that only holds an empty placeholder is left out of the rendered document
  detail: compileDocumentBodyToHandlebars wraps a p or h1 to h4 whose only content is one placeholder in an if block, so an empty optional value no longer leaves a blank line in mails and PDFs. Zero numbers and money values still render. Blocks with static text, images or several placeholders are unchanged.
  -->
  
  <!-- kumiko-changes
  feature: template-resolver
  type: improvement
  title: Mail layout buttons follow the branding accent colour
  detail: mailLayoutAppearance takes the tenant branding accent colour. When the layout uses the branding accent line, buttons in the mail body use that colour instead of the fixed dark teal. Invalid colours fall back to the previous default.
  -->
  
  <!-- kumiko-changes
  feature: channel-email
  type: fix
  title: List-Unsubscribe accepts an app-owned unsubscribe URL
  detail: When unsubscribeUrl in the mail data points to an http(s) URL outside the framework unsubscribe route, the email channel sets List-Unsubscribe to that URL without the one-click List-Unsubscribe-Post header, because the framework cannot vouch for a foreign endpoint accepting POST. Other schemes set no header.
  -->
  
  <!-- kumiko-changes
  feature: dev-server
  type: improvement
  title: composeRendererStack passes a mail footer resolver to the mail renderer
  detail: composeRendererStack({ mailFooter }) hands the resolver to createRendererMailHtmlFeature, so apps on the composed stack set imprint, privacy and platform line in one place.
  -->
  
  <!-- kumiko-changes
  feature: template-resolver
  type: fix
  title: A placeholder inside a button label is kept
  detail: The document schema allows placeholder chips inside a button label. Before, saving or seeding a body such as a button reading "View {{pageName}}" split the button: the label stopped at the placeholder and the rest landed in a new paragraph outside the button.
  -->
  
  <!-- kumiko-changes
  feature: template-resolver
  type: improvement
  title: compileDocumentBodyToHandlebars takes a height cap for resource images
  detail: The new resourceImageMaxHeightPx option adds max-height and width:auto to resource images. The mail renderer caps images in a layout header at 64 px, so a square logo stays small while a wide wordmark keeps its 180 px width cap.
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
- Updated dependencies [a546703]
- Updated dependencies [84d7f1a]
- Updated dependencies [72a5c9c]
- Updated dependencies [efa6253]
- Updated dependencies [5c276e6]
- Updated dependencies [21c5cbc]
- Updated dependencies [fbc6938]
- Updated dependencies [efa6253]
- Updated dependencies [72a5c9c]
- Updated dependencies [efa6253]
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
  - @cosmicdrift/kumiko-headless@0.365.0

## 0.364.0

### Minor Changes

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
- b5a6395: templateVariable.richText declares a notification variable that carries sanitized HTML
  
  <!-- kumiko-changes
  feature: template-resolver
  type: improvement
  title: templateVariable.richText for notification variables that carry formatted HTML
  detail: Notification variables are escaped, so a value holding HTML (for example a document written in a rich text editor) showed up as literal tags in the mail. A variable declared with templateVariable.richText({ required }) is run through the document sanitizer at render time and inserted as HTML; bold, italic, lists and safe links stay, script, event handlers and javascript links are not emitted as markup. If the sanitizer rejects a value, it is rendered as escaped text and a warning with the violation codes is logged. All other variable types stay escaped.
  -->

### Patch Changes

- c181b3f: Structured mail layouts show the mail body
  
  The structured layout frame wraps the body in mj-text instead of mj-raw. With mj-raw the body HTML sat directly in the column table, browsers moved it into the column wrapper with font-size 0, and every mail on a tenant layout had an invisible body.
  
  <!-- kumiko-changes
  feature: renderer-mail-html
  type: fix
  title: Structured mail layouts show the mail body
  -->
- 7482ee2: Mail renderer keeps wall-clock dates and system attachments
  
  <!-- kumiko-changes
  feature: renderer-mail-html
  type: fix
  title: Mail renderer keeps wall-clock dates and system attachments
  detail: The date helper keeps the calendar date of offset datetimes, tenant overrides of system mails keep inherited attachments, markdown templates use the system layout and delivery envelope keys are not exposed as variables.
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
- Updated dependencies [8e81d73]
- Updated dependencies [baf641a]
- Updated dependencies [8e81d73]
- Updated dependencies [92a9c52]
- Updated dependencies [15039ce]
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
  - @cosmicdrift/kumiko-headless@0.364.0

## 0.363.0

### Minor Changes

- 0a79504: Mail and PDF documents format dates and numbers by the template locale, dates in the long style

  <!-- kumiko-changes
  feature: renderer-mail-html
  type: breaking
  title: Documents format dates and numbers by the template locale, dates in the long style
  detail: readDocumentFormat used the tenant setting tenant-settings:config:locale ahead of the template locale, so a German invoice of a tenant set to English printed "Oct 1, 2026" and "€780.00". Mails, mail previews and document PDFs now format by the locale of the template that is rendered; the tenant settings still supply the currency. The date helper prints the long style ("1. Oktober 2026", "October 1, 2026") instead of the medium style ("01.10.2026", "Oct 1, 2026").
  migration: |
    Tests or snapshots that assert rendered dates change from "05.03.2026" to "5. März 2026" (de) and from "Mar 5, 2026" to "March 5, 2026" (en). A tenant that relied on tenant-settings:config:locale to change the number format of its documents now needs a template in that locale.
  -->

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

- 2972bc2: renderer-mail-html renders kind mail from document templates; the Markdown path is removed

  <!-- kumiko-changes
  feature: renderer-mail-html
  type: breaking
  title: renders kind mail from document templates, Markdown path removed
  detail: The plugin serves kind mail. It resolves the template by slug (contentFormat html, meta.subject required), compiles the document body to Handlebars through template-resolver, renders it in an isolated Handlebars instance (helpers money, date and link, HTML escaping on) and places the result into the mail-layout named by meta.layoutSlug (default slug default, in-code DEFAULT_MAIL_LAYOUT_MJML as fallback). The layout only sees content, subject, previewText, tenantName, signature, imprint and unsubscribeUrl. The response carries subject and previewText; the subject has line breaks removed. Markdown rendering and the content/contentFormat payload are gone; DEFAULT_MAIL_LAYOUT_MJML uses tenantName instead of appName. seedSystemMailLayout writes kind mail-layout slug default through seedSystemTemplate and is idempotent. New dependency on @cosmicdrift/kumiko-headless.
  migration: |
    Send kind mail requests with { slug, locale, variables } and move mail texts into kind mail templates (html body plus meta.subject), for example through r.notification({ template, meta }). Custom mail layouts become kind mail-layout, contentFormat mjml, slug default and use {{tenantName}} instead of {{appName}}; the body is inserted with {{{content}}}.
  -->

- f7da271: The mail-html renderer plugin moves from kumiko-enterprise into the framework under the `@cosmicdrift` scope; the API is unchanged.

  <!-- kumiko-changes
  feature: renderer-mail-html
  type: breaking
  title: Package moved to the framework under the @cosmicdrift scope
  detail: Renamed from @cosmicdriftgamestudio/kumiko-renderer-mail-html (GitHub Packages, kumiko-enterprise) to @cosmicdrift/kumiko-renderer-mail-html on npmjs; the API is unchanged.
  migration: |
    Replace @cosmicdriftgamestudio/kumiko-renderer-mail-html with @cosmicdrift/kumiko-renderer-mail-html in package.json and in every import; install from npmjs instead of GitHub Packages.
  -->

- d35e9a0: Mail template editor building blocks: file attachments, system copy-locale, display preview, labelled chips

  <!-- kumiko-changes
  feature: template-resolver
  type: improvement
  title: Mail templates carry file attachments (PDF, PNG, JPEG)
  detail: linkedResources stays image only; file attachments of a mail template are listed in the optional TemplateResource.fileAttachments (kind file, fileRefId, fileName), sorted by key. template-resolver:write:resource-upload takes purpose "attachment" with a fileName; it checks the file by content (PDF, PNG, JPEG), keeps the original bytes, allows at most 10 per mail template and stores the entry next to the inline images. resource-remove, copy-locale and the bundle export/import carry attachments (bundle resource entries get purpose "attachment"). The preview lists attachments with kind "inline" or "file" (PreviewAttachment is now a union), send-test sends them, and the mail renderer attaches them after the inline images within the delivery attachment limit.
  -->

  <!-- kumiko-changes
  feature: template-resolver
  type: improvement
  title: copy-locale can copy system templates (scope "system", system admins only)
  detail: template-resolver:write:copy-locale takes scope "tenant" (default) or "system". With "system" a system admin copies a system template to another locale as a draft; other callers get access denied.
  -->

  <!-- kumiko-changes
  feature: template-resolver
  type: improvement
  title: Mail preview returns displayHtml for the editor
  detail: The preview of a mail template carries displayHtml, the body with cid images replaced by data URIs (png, jpeg, gif, webp, 5 MiB budget in total) so an editor can show it without cid support. The sent mail is unchanged.
  -->

  <!-- kumiko-changes
  feature: template-resolver
  type: improvement
  title: Document editor gets variable labels, a handle, resource previews, canvas chrome, underline and PlaceholderLineEditor
  detail: DocumentContentEditor accepts variableLabels, systemVariables, resourcePreviews, chrome ("default" or "canvas") and onEditorReady (handle with insertPlaceholder, insertResource, focus). The new PlaceholderLineEditor edits plain text with {{name}} placeholders as chips on one line. Underline (u) is part of the document schema and survives the sanitizer.
  -->

  <!-- kumiko-changes
  feature: delivery
  type: improvement
  title: ChannelContext.readAttachment takes an attachment origin
  detail: readAttachment(ref, origin) with origin "template" (from the renderer) or "message" (default, from notify data). Only template attachments may fall back to the system tenant; file refs from notify data stay limited to the sending tenant.
  -->

- 549a6f6: Mail templates can attach a PDF rendered from a document template; preview and test mail use the resources of the edited row

  <!-- kumiko-changes
  feature: template-resolver
  type: improvement
  title: Mail templates link a PDF rendered from a document template (resource-link-pdf)
  detail: New write template-resolver:write:resource-link-pdf takes templateId, key, templateSlug and fileName and stores a linkedResources entry { kind "rendered-pdf", templateSlug, fileName } in a mail template; nothing is uploaded. fileName is a one-line pattern that may use the mail's {{placeholders}} and must end with .pdf (no / \ " ; or ..). The document-pdf template must exist for the tenant or the system, otherwise the write fails with template_attachment_pdf_template_missing; an invalid pattern or slug fails with template_attachment_invalid. Uploaded files and linked PDFs share the limit of 10 attachments per template. resource-remove, copy-locale and the bundle export/import carry the entry (the bundle gets an optional pdfAttachments map of key to { templateSlug, fileName }; import does not check that the document template exists). TemplateResource gains pdfAttachmentLinks, LinkedResourceEntry gains the TemplatePdfAttachmentLink variant.
  -->

  <!-- kumiko-changes
  feature: template-resolver
  type: improvement
  title: Preview and test mail use the images and attachments of the edited row, also while it is a draft
  detail: When preview or send-test get content and the caller has a row for (slug, kind, locale), that row supplies linkedResources whatever its status (also when it has none, so nothing is borrowed from the system template), so a tenant whose customization is saved as a draft sees its logo and attachments. MailDraft has an optional linkedResources; without it the stored active template's resources are used as before. PreviewAttachment gains the variant { kind "rendered-pdf", name, templateSlug } without sizeBytes, because the PDF is not rendered in the preview; size_under_cap does not count it.
  -->

  <!-- kumiko-changes
  feature: renderer-mail-html
  type: improvement
  title: Mail renderer attaches linked PDF templates as rendered-pdf attachments
  detail: The renderer builds a RenderedPdfAttachmentRef per linked PDF with the mail's render variables, the mail locale and the file name pattern rendered like the subject and cleaned by sanitizePdfAttachmentFileName, now exported from @cosmicdrift/kumiko-bundled-features/delivery (control characters and / \ " ; .. removed, at most 200 characters including .pdf, empty falls back to the last slug segment). Order is inline images, files, rendered PDFs, all within MAX_EMAIL_ATTACHMENTS; variables above MAX_RENDERED_PDF_VARIABLES_BYTES fail the render with the mail slug. RenderedPdfAttachmentRef now lives in renderer-foundation (still exported from delivery) and RenderResponse and RenderedMail allow it.
  -->

- f3fe91e: Template preview and test mail

  <!-- kumiko-changes
  feature: template-resolver
  type: improvement
  title: Preview query and send-test write for mail and PDF templates
  detail: template-resolver:query:preview renders a draft, or the stored template when no content is given, with sample values from the declared variable examples (list variables get two rows). The draft passes the same write gates as a save and a mail goes through the real mail renderer, so subject, html, plain text and inline images match a real send. The response carries checks (images resolved, plain text present, size under 10 MiB, required placeholders used); a PDF template returns its sanitized body and the layout regions. template-resolver:write:send-test mails the rendered mail to the calling user's own address only, subject prefixed with [TEST], limited to 10 per user and hour. It needs delivery, channel-email and renderer-mail-html.
  -->

  <!-- kumiko-changes
  feature: delivery
  type: improvement
  title: EMAIL_CHANNEL_NAME, createTemplateMailRenderer and createEmailAttachmentReader are exported
  detail: The email channel name is a shared constant instead of a string literal. The mail renderer and the inline-attachment reader that build the channel context are exported and accept a tenant-bound db, so a handler can send through the same path as a notification.
  -->

  <!-- kumiko-changes
  feature: renderer-foundation
  type: improvement
  title: MailPayload.draft renders an unsaved mail template; RendererContext.db also accepts a TenantDb
  detail: MailDraft (content, meta, variableSchema) replaces the stored body and subject of the template with the payload's slug and keeps its stored images; a slug without a stored template renders as a tenant draft. The renderer sanitizes the draft body and validates its meta again, and the response carries no template provenance. RendererContext.db is widened from DbConnection to DbRunner | TenantDb.
  -->

  <!-- kumiko-changes
  feature: renderer-mail-html
  type: improvement
  title: Renders a MailPayload.draft instead of the stored template body and subject
  detail: With a draft the stored template of the slug only supplies its linked images and variable schema; the body goes through the document sanitizer and the meta through the mail meta check, and a violation is an invalid_payload error. The response has no template reference because a draft is not a stored version.
  -->

- 46b83b8: Template contracts: PDF meta, render provenance, system lifecycle, usage and override queries

  - `document-pdf` templates take a strict meta (layoutSlug, pageFormat, margins in mm, fileName, metadata); `readPdfTemplateMeta` reads it for the PDF renderer.
  - `RenderResponse` carries `template` and `layout` (id, version, scope) of the rows a mail was rendered from; the mail renderer fills them.
  - New write handlers `publish-system`, `archive-system` (SystemAdmin) and `reset-to-system` (archives a tenant override); `publish` and `archive` now refuse system rows.
  - New queries `usage`, `tenant-overrides` (counts only) and `diff-to-system`; `find-by-id` also returns `meta`.

  <!-- kumiko-changes
  feature: template-resolver
  type: improvement
  title: PDF template meta, render provenance, system template lifecycle and override queries
  detail: kind document-pdf takes a strict meta (layoutSlug, pageFormat A4/Letter, margins in mm, fileName without / \ " ; or .., metadata title/author); new exports PDF_PAGE_FORMATS, PdfPageFormat, PdfTemplateMeta, readPdfTemplateMeta, DEFAULT_MAIL_LAYOUT_SLUG. RenderResponse (renderer-foundation) gains optional template and layout refs ({ templateId, templateVersion, scope }, new types RenderedTemplateRef and RenderProvenance); renderer-mail-html fills them. New handlers template-resolver:write:publish-system and archive-system (SystemAdmin), reset-to-system (TenantAdmin, SystemAdmin), queries usage, tenant-overrides (SystemAdmin, counts only) and diff-to-system. publish and archive answer not_found for rows outside the caller's tenant instead of a version_conflict; find-by-id also returns meta.
  -->

- cbed66e: Template resources (images) and mail attachments

  <!-- kumiko-changes
  feature: template-resolver
  type: breaking
  title: linkedResources is no longer a payload field of upsertSystem/upsertTenant; resourceUpload and resourceRemove manage it
  detail: Two steps - upload the image with POST /api/files (multipart, no entityType), then call template-resolver:write:resource-upload with { sourceFileRefId, templateId?, key? }. The handler re-encodes the caller's own unclaimed upload into a new file ref (width at most 1200 px) and links it into the template; resource-remove unlinks a key. upsertSystem and upsertTenant no longer accept linkedResources and leave the stored value untouched on update. The size cap is the system config key resource-max-bytes (default 2 MiB); a cap above the files route's maxUploadSize has no effect because the upload is rejected first. The source upload stays as an unclaimed file.
  migration: |
    Whoever sent linkedResources with upsertSystem or upsertTenant now uploads the image via POST /api/files (multipart, no entityType) and links it with template-resolver:write:resource-upload { sourceFileRefId, templateId, key }. Server-side seeding (seedSystemTemplate linkedResources) stays.
  -->

  <!-- kumiko-changes
  feature: delivery
  type: improvement
  title: Notification messages carry attachments (file refs and inline cid images)
  detail: RenderedMessage and the send job payload accept attachments as references (kind file or inline), never bytes. ChannelContext.readAttachment resolves them tenant-scoped at send time; createDeliveryService takes a new filesForTenant option for the inline fallback path.
  -->

  <!-- kumiko-changes
  feature: channel-email
  type: improvement
  title: Email channel sends file attachments and inline cid images
  detail: EmailMessage.attachments is sent through the SMTP transport (inline images with Content-ID). notify data.attachments with kind file entries are resolved through the file store; the PII guard rejects ciphertext file names.
  -->

  <!-- kumiko-changes
  feature: delivery
  type: improvement
  title: NotifyFactory takes an optional fileProviderResolver, so immediate and bootstrap mails can read attachments too
  -->

  <!-- kumiko-changes
  feature: template-resolver
  type: improvement
  title: Bundle import re-encodes its images like resource-upload; re-seeding keeps uploaded system resources
  detail: importBundle and importBundleSystem store each bundle resource through the same normalization as resource-upload (decoded format decides the content type, SVG and non-images are rejected, width at most 1200 px, resource-max-bytes applies), so an exported bundle carries the re-encoded bytes. seedSystemTemplate without linkedResources no longer resets the links of an existing row, so images a system admin uploaded survive the next boot. storeTemplateResource from the template-resolver barrel is the normalizing store; the raw byte variant is gone.
  -->

  <!-- kumiko-changes
  feature: delivery
  type: fix
  title: Queued mails render with the tenant's config again
  detail: The delivery render and send jobs read the tenant config through ctx.configFor, which job contexts do not carry, so queued mails rendered without tenant name, locale, currency and branding. Both jobs now use ctx.config, which the job runner builds for the payload's tenant.
  -->

- 366d89f: Template validation query, layout kinds as structured html, bundle import/export, copy-locale and notification record mapping

  <!-- kumiko-changes
  feature: template-resolver
  type: breaking
  title: Tenant mail-layouts are structured html, pdf-layout and document-pdf are placeholder-validated
  detail: A new validate query dry-runs the write pipeline (used, unknown and missing placeholders, canSave, canPublish). document-pdf, pdf-layout and mail-layout now go through the same placeholder gate as mail; document-pdf and pdf-layout know the system placeholders page and pages. A tenant mail-layout is html with a data-content slot plus header, signature and footer regions that renderer-mail-html wraps in a fixed MJML frame; raw mjml (with {{{content}}} exactly once) is system-only. New handlers export-bundle, import-bundle, import-bundle-system and copy-locale move a template with its resource files between tenants and locales. r.notification accepts a record mapping from an entity row to the declared variables, validated at boot. publish and archive no longer touch system rows through a tenant-scoped SystemAdmin.
  migration: |
    Tenant mail-layout rows stored as mjml are ignored by the renderer, which falls back to the system layout; re-create them as html with a data-content slot. upsert-system answers with an extra validation field. seedSystemTemplate errors now read `<label> rejected: <code> (<detail>); ...`. Layout bodies without the content slot are rejected on write. `set` now runs the same gate for mail, document-pdf, pdf-layout and mail-layout rows and rejects unsanitized markup or publish issues, since saving publishes; the mail renderer also re-sanitizes stored tenant html layouts and falls back to the system layout when they fail. upsert-system and upsert-tenant no longer accept linkedResources (resources go through the resource upload; bundle import and copy-locale attach them). Unknown data-resource keys are a validate warning (resource_not_uploaded), not a write error.
  -->

### Patch Changes

- 6b8d89b: The default mail layout shows the mail body

  The in-code default mail layout wraps the body in mj-text instead of mj-raw. With mj-raw the body HTML sat directly in the column table, browsers moved it into the column wrapper with font-size 0, and every mail without a mail-layout row had an invisible body. seedSystemMailLayout updates a seeded row on its next run.

  <!-- kumiko-changes
  feature: renderer-mail-html
  type: fix
  title: The default mail layout shows the mail body
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
- Updated dependencies [b022cca]
- Updated dependencies [fcd6eb4]
- Updated dependencies [2972bc2]
- Updated dependencies [2972bc2]
- Updated dependencies [ef689d8]
- Updated dependencies [4a748c3]
- Updated dependencies [0a79504]
- Updated dependencies [0a79504]
- Updated dependencies [2972bc2]
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
  - @cosmicdrift/kumiko-headless@0.363.0
