---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-renderer-puppeteer-client": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-renderer-mail-html": minor
"@cosmicdrift/kumiko-locale-de": minor
"@cosmicdrift/kumiko-locale-es": minor
"@cosmicdrift/kumiko-locale-fr": minor
"@cosmicdrift/kumiko-locale-it": minor
---

PDF templates can express a typical business letter: images with a print width, alignment and a full-bleed header or footer image, hard line breaks in paragraphs and table cells, table rows after the repeat row, divider color and weight, a table line color, DIN 5008 fold marks, a header or footer that starts on page 2, per-table cell padding, width and alignment, row lines above and below a row, a short or long date format per placeholder, corner marks on every page, and a paper color for the whole page.

<!-- kumiko-changes
feature: template-resolver
type: improvement
title: PDF templates cover typical business letters
detail: patch-draft accepts image `widthMm`, `align` and `bleed` (bleed only in the header or footer of a pdf-layout, otherwise `bleed_not_allowed`), the run `{hardBreak:true}`, table `rowsAfterRepeat`, and divider `color` and `weightPt`. Layout meta gains `tableLineColor`, `foldMarks` (none, din-a, din-b) and `headerOnFirstPage` / `footerOnFirstPage`, plus `cornerMarks` (boolean, angles 10 mm from the paper edge, drawn by pdf-lib like the fold marks) and `paperColor` (`#rrggbb`, pdf-lib fills each page with it underneath all content, bleed images included; absent means white). Tables take `cellPaddingMm` (0 to 10), `widthMm` and `align`; table rows take `lineAbove` / `lineBelow` `{color, weightPt}` that beat `tableLineColor` on that edge, also on the repeat row and `rowsAfterRepeat`; a text run takes `dateStyle` (`short` 15.01.2026 or `long`, the default) for the placeholders in it, which `{{date x dateStyle="short"}}` renders in PDFs and mails. Filled cells in the outer columns keep a small inset so their text no longer sticks out of the fill, and the footer region's table cells are top-aligned like the body. The editor schema loads and writes the new attributes unchanged. renderer-puppeteer-client prints a header or footer that skips page 1 as a second render merged with pdf-lib and draws fold marks on every page. The full-bleed rule is now scoped per region, because Chromium shares one document for header and footer and an unscoped rule moved the footer image to the top edge.
-->
