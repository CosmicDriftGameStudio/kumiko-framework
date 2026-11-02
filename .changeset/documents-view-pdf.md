---
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-types": patch
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-locale-de": patch
"@cosmicdrift/kumiko-locale-es": patch
"@cosmicdrift/kumiko-locale-fr": patch
"@cosmicdrift/kumiko-locale-it": patch
---

The documents list and the documents tab offer a View action for PDFs that opens the PDF viewer in a drawer.

<!-- kumiko-changes
feature: documents
type: improvement
title: documents list and tab show a View action for PDFs
detail: The file renderer takes `viewInDrawer: true`; list cells then show a View button for PDFs (MIME from the batched `useFileMeta`, one `/api/files/meta` request per page) that opens `PdfPreview` in a drawer. `documents:screen:list` and the documents tab set it. New export `FileViewAction` for custom columns, new i18n key `kumiko.field.file-list.view` (en, de, es, fr, it).
-->
