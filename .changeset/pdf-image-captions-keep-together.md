---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-renderer-puppeteer-client": minor
---

An entry of an `images` variable may be `{ fileRefId, caption? }` as well as a FileRef id string (type `DocumentImageValue` from `@cosmicdrift/kumiko-bundled-features/template-resolver`); a captioned image renders as `<figure class="kumiko-doc-image">` with a `<figcaption>`, the caption capped at 200 characters. The Images block takes `data-image-columns="1" | "2" | "3"` (default 2, other values are dropped). Document PDFs keep headings with the following text and no longer split paragraphs, list items, table rows or figures across pages; tables of up to 8 rows stay whole, longer ones break between rows.

<!-- kumiko-changes
feature: template-resolver
type: improvement
title: PDF image captions, image columns and page-break rules
detail: Entries of an `images` variable can carry a caption (`{ fileRefId, caption }`), printed under the image as a figcaption. The Images block accepts `data-image-columns` 1, 2 or 3. The print CSS keeps headings with the next paragraph and avoids splitting paragraphs, list items, table rows and figures across pages; tables of up to 8 rows stay whole.
-->
