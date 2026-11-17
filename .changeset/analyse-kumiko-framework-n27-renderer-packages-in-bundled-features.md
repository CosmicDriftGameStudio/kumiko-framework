---
"@cosmicdrift/kumiko-bundled-features": minor
---

The packages `@cosmicdrift/kumiko-renderer-mail-html` and `@cosmicdrift/kumiko-renderer-puppeteer-client` are now features of bundled-features; document-draft and signature use the print client directly.

<!-- kumiko-changes
feature: renderer-puppeteer-client
type: breaking
title: Mail and PDF renderers live in bundled-features, document-draft and signature print without injected functions
detail: The packages `@cosmicdrift/kumiko-renderer-mail-html` and `@cosmicdrift/kumiko-renderer-puppeteer-client` are removed. Their code ships as `@cosmicdrift/kumiko-bundled-features/renderer-mail-html` (plus `/renderer-mail-html/seeding`) and `@cosmicdrift/kumiko-bundled-features/renderer-puppeteer-client` (plus `/renderer-puppeteer-client/qualified-names`) with the same exports, feature names, entity `rendered-pdf`, table and environment variables, so no data migration is needed. `createDocumentDraftFeature` loses its `pdf` option and its type parameter, `createSignatureFeature` loses `renderHtmlToPdf`; both render through the print client themselves and require the `renderer-puppeteer-client` feature at boot. The types `DocumentDraftPdf` and `RenderSignatureHtmlToPdf` are gone.
migration: Replace the two package names in imports and package.json with the `@cosmicdrift/kumiko-bundled-features/renderer-mail-html` and `@cosmicdrift/kumiko-bundled-features/renderer-puppeteer-client` subpaths (keep one bundled-features dependency). Then delete the `pdf: { render, store }` option from `createDocumentDraftFeature(...)` and `renderHtmlToPdf` from `createSignatureFeature(...)`, and mount `createRendererPuppeteerClientFeature()` wherever document-draft or signature is mounted.
-->
