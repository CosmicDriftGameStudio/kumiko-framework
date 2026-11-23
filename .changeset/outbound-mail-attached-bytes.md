---
"@cosmicdrift/kumiko-bundled-features": patch
---

A mail sent in beforeTransaction can attach bytes the handler just produced, such as a freshly rendered PDF.

<!-- kumiko-changes
feature: inbound-mail-foundation
type: improvement
title: sendMailFromAccount attaches bytes from the same beforeTransaction
detail: `sendMailFromAccount` takes `attachedBytes` (fileName, mimeType, data). They go out after the files of `attachmentFileIds`, share the limit of 10 attachments and OUTBOUND_ATTACHMENTS_MAX_BYTES, and are not access-checked because the caller holds them. `renderPdfBeforeTransaction` returns the PDF as `pdfBytes` on its upload when called with `keepPdfBytes: true`, so one handler can mail the PDF and store it with `storeRenderedPdf`. The `inmemory` provider can now send and records mails for `sentMailsOf(accountId)`.
-->
