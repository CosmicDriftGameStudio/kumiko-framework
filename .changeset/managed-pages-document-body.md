---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-locale-de": minor
"@cosmicdrift/kumiko-locale-es": minor
"@cosmicdrift/kumiko-locale-fr": minor
"@cosmicdrift/kumiko-locale-it": minor
---

Managed pages can have an editor document as their body.

<!-- kumiko-changes
feature: managed-pages
type: breaking
title: A managed page body is Markdown or an editor document, edited in the document editor
detail: The page entity has a new field bodyFormat ("markdown" or "document", default markdown). Pages and events from before the field read as markdown and render unchanged. A document body is HTML from the template-resolver document editor; page create, update and managed-pages:write:set check it with sanitizeDocumentHtml and store the rebuilt HTML and answer a rejected body with field errors on body (i18n key managed-pages.errors.document.rejected, new in all locale packages). The public render sanitizes a document body again and serves an empty body, with a logged warning, when a stored one fails. managed-pages:write:set takes an optional bodyFormat; omitting it sets markdown, it does not preserve the stored format. The page-edit screen no longer has a body textarea: its body section is the extension section managed-pages:page-body (PAGE_BODY_EXTENSION_NAME), which opens a Markdown body converted to HTML, shows a warning for what the conversion drops (images, block quotes, code, headings below level 3, relative links) and writes body and bodyFormat "document" only after the first edit. The ETag of the public page includes bodyFormat. seedPage takes an optional bodyFormat and throws on a rejected document body.
migration: Run `kumiko-schema generate` and apply the migration; read_pages gets a bodyFormat column with default 'markdown', no rebuild is needed. Mount `managedPagesClient()` from `@cosmicdrift/kumiko-bundled-features/managed-pages/web` in createKumikoApp({ clientFeatures }); without it the body section of page-edit shows the missing-component placeholder. Apps that replaced page-edit with their own screen keep the textarea and send no bodyFormat, so their pages stay markdown.
-->
