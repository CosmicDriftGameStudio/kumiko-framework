---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-renderer-puppeteer-client": minor
"@cosmicdrift/kumiko-renderer-mail-html": minor
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-locale-de": patch
"@cosmicdrift/kumiko-locale-es": patch
---

Document PDFs are rendered from stored templates by renderer-puppeteer-client

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
