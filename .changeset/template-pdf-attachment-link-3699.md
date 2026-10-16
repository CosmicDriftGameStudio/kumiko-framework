---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-renderer-mail-html": minor
---

Mail templates can attach a PDF rendered from a document template; preview and test mail use the resources of the edited row

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
