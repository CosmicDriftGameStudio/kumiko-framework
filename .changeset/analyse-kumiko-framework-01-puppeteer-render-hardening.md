---
"@cosmicdrift/kumiko-renderer-puppeteer-client": patch
---

The puppeteer service isolates each render, times out hung screenshots and no longer returns internal error text.

<!-- kumiko-changes
feature: renderer-puppeteer-client
type: fix
title: Puppeteer service isolates renders and limits bodies without Content-Length
detail: Each render now runs in its own browser context (own cookies, cache and storage) that is closed afterwards, instead of sharing the default context across tenants. Image screenshots get the same `RENDER_TIMEOUT_MS` budget as setContent and PDF and answer 504 when it runs out. `/render` and `/rasterize` check the token first and then count the body bytes while reading, so a request without `Content-Length` can no longer skip the size limit; it answers 413 `payload_too_large`. `render_failed`, `rasterize_failed` and `invalid_pdf` responses no longer carry `details`; the service writes the cause to its log instead.
-->
