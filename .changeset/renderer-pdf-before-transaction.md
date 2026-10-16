---
"@cosmicdrift/kumiko-renderer-puppeteer-client": minor
---

renderAndStorePdf is replaced by renderPdfBeforeTransaction and storeRenderedPdf

<!-- kumiko-changes
feature: renderer-puppeteer-client
type: breaking
title: renderAndStorePdf is removed; render in beforeTransaction with renderPdfBeforeTransaction and store with storeRenderedPdf
detail: renderAndStorePdf called the print service inside the write transaction and held a pool connection for the whole render. renderPdfBeforeTransaction(ctx, { slug, locale, variables, attachTo? }) now renders and uploads the PDF before the transaction opens, and storeRenderedPdf(ctx, event.prepared) writes the fileRef and rendered-pdf rows inside it. RenderAndStorePdfArgs is renamed RenderPdfArgs.
migration: Move the render into the handler's beforeTransaction phase and store in the handler: defineWriteHandler({ name, schema, access, beforeTransaction: (event, ctx) => renderPdfBeforeTransaction(ctx, { slug: "invoice", locale: "de", variables }), handler: (event, ctx) => storeRenderedPdf(ctx, event.prepared) }). The result of storeRenderedPdf has the same shape as the old renderAndStorePdf result (StoredRenderedPdf). Rename the RenderAndStorePdfArgs type to RenderPdfArgs. A handler with a beforeTransaction phase cannot be called through a nested ctx.write; call it as a top-level command.
-->
