---
"@cosmicdrift/kumiko-renderer-puppeteer-client": minor
---

`renderPdfBytes(ctx, { slug, locale, variables })` renders a PDF and returns `fileName`, `pdfBytes`, `pageCount`, `sizeBytes`, `template` and `layout` without storing a file or a rendered-pdf row. `renderPdfBeforeTransaction` now builds on it.

<!-- kumiko-changes
feature: renderer-puppeteer-client
type: improvement
title: Render a PDF without storing it
detail: renderPdfBytes is the render half of renderPdfBeforeTransaction. Use it when the bytes go straight into a mail or a download and no file or rendered-pdf row should exist.
-->
