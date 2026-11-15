---
"@cosmicdrift/kumiko-renderer-puppeteer-client": patch
---

Headings in PDF documents stay with the block that follows them. The print rule `break-after:avoid` on `h1` to `h4` (already in `PRINT_CSS`) is now covered by a real-Chromium test: a heading that would end a page moves to the next page together with its paragraph, and a paragraph longer than a page still splits.

<!-- kumiko-changes
feature: renderer-puppeteer-client
type: improvement
title: A heading never stands alone at the end of a PDF page
detail: A heading (level 1 to 4) moves to the next page together with the first block after it, with no setting; long paragraphs and tables after it still split across pages. Section titles must be `heading` blocks for this to apply: a bold paragraph is not kept with the next block, so move such titles of existing templates to `heading` with the same text style.
-->
