---
"@cosmicdrift/kumiko-bundled-features": patch
---

`renderPdfsBeforeTransaction` prints several PDFs for one write, and the HTTP client honours `Retry-After` on 503.

<!-- kumiko-changes
feature: renderer-puppeteer-client
type: improvement
title: Several PDFs per write with renderPdfsBeforeTransaction
detail: `renderPdfsBeforeTransaction(ctx, documents)` takes the arguments of `renderPdfBeforeTransaction` once per document, renders and uploads at most two at a time and returns the uploads in input order. When one document fails, it starts no further document, removes every file it already uploaded and returns that failure. When the write itself fails or rolls back, the one release it returns removes all uploads. Pass each upload to `storeRenderedPdf` inside the transaction. On a 502 or 503 the HTTP client now waits at least the `Retry-After` seconds the service sends, capped at 10 seconds, before it retries.
-->
