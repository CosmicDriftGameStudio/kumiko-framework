---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-renderer-puppeteer-client": patch
---

A layout whose header or footer skips page 1 no longer prints the whole document twice; the second print renders page 1 only.

<!-- kumiko-changes
feature: renderer-puppeteer-client
type: improvement
title: First-page reprint is limited to page 1
detail: Chromium cannot leave out a header or footer on page 1 alone, so such layouts print a second time and swap in page 1. That second print now sends `pageRanges: "1"` and renders one page instead of the whole document, which halves the Chromium time of these documents. `PdfOptions` has an optional `pageRanges`, and the puppeteer service accepts and validates it. The swap takes page 1 of the second print and no longer requires both prints to have the same page count.
-->
