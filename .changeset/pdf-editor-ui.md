---
"@cosmicdrift/kumiko-document-designer": minor
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-renderer-puppeteer-client": minor
"@cosmicdrift/kumiko-renderer-web": patch
---

Add the PDF template editor screen (`@cosmicdrift/kumiko-document-designer/web`): placeholder panel, page canvas with layout header and footer, page settings, validation footer and a pdf.js preview. The template-resolver document editor gains an `align` block, labelled placeholder chips, a repeat-table bar and an `onEditorReady` handle; `template-resolver/web` exports the qualified names; `renderer-puppeteer-client` exports `./qualified-names`; renderer-web's stylesheet scans the new package.

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
