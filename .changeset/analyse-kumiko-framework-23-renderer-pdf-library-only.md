---
"@cosmicdrift/kumiko-bundled-features": minor
---

`renderer-pdf` is a library only: `createRendererPdfFeature` is removed, `renderTablePdf` stays.

<!-- kumiko-changes
feature: renderer-pdf
type: breaking
title: renderer-pdf no longer registers a document-pdf plugin
detail: The plugin registered as "pdf" for `kind: "document-pdf"` but expected a table document in `payload.variables`, while every document-pdf caller (delivery attachments, template preview, render-and-store) sends a template slug with variables. Without Puppeteer mounted it was picked for those calls and failed with `invalid_payload` at runtime. `createRendererPdfFeature` and `renderTablePdfRequest` are removed; `renderTablePdf(doc, options)` and `pdfTableDocumentSchema` remain the way to draw a table PDF.
migration: Remove `createRendererPdfFeature()` from the feature list and call `renderTablePdf` directly where a table PDF is needed.
-->
