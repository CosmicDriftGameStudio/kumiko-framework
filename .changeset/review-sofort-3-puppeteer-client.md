---
"@cosmicdrift/kumiko-renderer-puppeteer-client": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

image-snapshot reports the real image size, and the pdf-layout default slug has one source

<!-- kumiko-changes
feature: renderer-puppeteer-client
type: fix
title: image-snapshot width and height come from the image header; PDF default layout slug is shared
detail: The service screenshots the full page, so the image can be taller than the requested viewport; the response now reports the size read from the PNG or JPEG header. DEFAULT_PDF_LAYOUT_SLUG is exported from template-resolver and used by both the PDF renderer and the editor preview, so they cannot pick different layouts. image-snapshot HTML must embed all resources as data: URIs because the service fetches no http(s) resources.
-->
