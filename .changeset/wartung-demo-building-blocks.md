---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-headless": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

New `renderer-pdf` bundled feature: `renderTablePdf(doc)` draws a table document as a PDF in pure JavaScript (pdf-lib, no browser, no native dependency). The document has a title, meta lines, weighted columns, cell wrapping, a header row repeated on every page and a footer with page numbers. `createRendererPdfFeature()` registers it as the `pdf` plugin for `kind: "document-pdf"` in `renderer-foundation`. Recipe: `samples/recipes/pdf-audit-export`.

`createFileRefFromBytes(ctx, { fileName, mimeType, data, attachTo? })` from `@cosmicdrift/kumiko-framework/files` stores bytes a write handler or job produced itself as a FileRef. It runs the same pipeline as `POST /api/files`, which now calls it too. That covers the identifier check, field resolution, size and accept limits, content sniffing and the MIME allowlist, the tenant-bound storage key and the `fileRef.created` event. Rejections come back as 422 `file_rejected` with the upload error in `details.error`.

`createImagesField({ capture })` forwards `capture` to the edit view model the same way `createImageField` does.

Cron jobs take an optional IANA time zone: `trigger: { cron: "0 7 * * *", tz: "Europe/Berlin" }`. Boot aborts for an invalid zone.

`createUserProfileFeature({ allowEmailChange: false })` drops the `change-email` handler and the email section of the profile screen. The default keeps both.

<!-- kumiko-changes
feature: renderer-pdf
type: improvement
title: Pure-JS PDF renderer for table documents
detail: renderTablePdf(doc, options?) renders a PdfTableDocument (title, subtitle, meta lines, weighted columns, wrapped cells, header row repeated per page, footerText and a pageLabel template with {page} and {pages}) to PDF bytes with pdf-lib. Characters outside WinAnsi are replaced by "?". Identical input yields identical bytes. createRendererPdfFeature() registers it as plugin "pdf" for kind "document-pdf"; payload.variables is validated against pdfTableDocumentSchema, anything else fails with RendererError invalid_payload.
-->

<!-- kumiko-changes
feature: framework
type: improvement
title: createFileRefFromBytes creates FileRefs from handler- or job-produced bytes
detail: createFileRefFromBytes({ db, files, registry, user }, { fileName, mimeType, data, attachTo? }) shares one pipeline with POST /api/files, so identifier checks, field-level maxSize/accept, content sniffing, MIME resolution, the tenant-prefixed storage key and the fileRef.created event are identical. The tenant always comes from ctx.user. A rejected file returns a 422 write failure with reason file_rejected and the upload error string in details.error. The FileRef's insertedById is the passed user, so the default access guard lets only that user and privileged roles read files attached to an entity.
-->

<!-- kumiko-changes
feature: framework
type: improvement
title: Cron jobs with an IANA time zone, images fields with capture
detail: A cron trigger accepts tz (IANA name, default UTC) and is scheduled in that zone, DST included. r.job() throws at boot for an invalid zone. createImagesField accepts capture ("environment" | "user") like createImageField, and the edit view model carries it for images fields.
-->

<!-- kumiko-changes
feature: user-profile
type: improvement
title: change-email can be switched off
detail: createUserProfileFeature({ allowEmailChange: false }) neither registers the change-email write handler nor shows the email section on the profile screen. Without the option nothing changes.
-->
