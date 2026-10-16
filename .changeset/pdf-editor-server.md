---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-renderer-puppeteer-client": minor
"@cosmicdrift/kumiko-renderer-mail-html": minor
---

Server side of the PDF editor: PDF preview, page setup and text alignment

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
