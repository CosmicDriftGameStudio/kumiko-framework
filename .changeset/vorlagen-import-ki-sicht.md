---
"@cosmicdrift/kumiko-renderer-puppeteer-client": minor
---

An AI assistant can look at a printed PDF: the new preview-png query returns the pages of a template draft as PNG images.

<!-- kumiko-changes
feature: renderer-puppeteer-client
type: improvement
title: preview-png and rasterizePdf let an agent see the printed result
detail: The puppeteer-service has a new POST /rasterize route (poppler: pdftoppm, optionally pdfimages) that turns a PDF into PNG pages, limited by MAX_PDF_BYTES and MAX_RASTER_PAGES; the service image now ships poppler-utils. The client exports rasterizePdf(bytes, options) and the constant AGENT_IMAGES_RESULT_KEY. The new preview-png query prints a draft like preview-pdf (same rights and input) and returns pages plus agentImages.
-->
