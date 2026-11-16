---
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-renderer-puppeteer-client": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

Document text, the PDF frame and the signature page escape HTML through the shared renderer escape.

<!-- kumiko-changes
feature: renderer
type: fix
title: Document text escapes quotes through the shared HTML escape
detail: `textToDocumentHtml` used its own escape that left `"` unescaped; it now uses `escapeHtml` from `@cosmicdrift/kumiko-renderer/headless`, so quotes become `&quot;` and `documentHtmlToText` turns them back. The PDF frame in renderer-puppeteer-client and the signature page in bundled-features drop their private copies for the same shared `escapeHtml` and `escapeHtmlAttr`; their output is unchanged.
-->
