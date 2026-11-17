---
"@cosmicdrift/kumiko-bundled-features": patch
---

A PDF whose HTML exceeds the puppeteer service limit now fails with `rendered_pdf_too_large` instead of `rendered_pdf_invalid_request`.

<!-- kumiko-changes
feature: renderer-puppeteer-client
type: improvement
title: Oversized PDF requests report rendered_pdf_too_large
detail: The service answers 413 when the HTML, the PDF or a raster result exceeds its limit. The client mapped every 4xx to `invalid_payload`, so photo PDFs failed with a meaningless error. `RendererError` has the new code `payload_too_large` plus optional `limits` (`maxBytes`, `gotBytes`), and PDF writes answer 422 `rendered_pdf_too_large` with those sizes in `details`.
-->
