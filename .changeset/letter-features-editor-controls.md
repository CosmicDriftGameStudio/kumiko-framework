---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-document-designer": minor
"@cosmicdrift/kumiko-locale-de": minor
"@cosmicdrift/kumiko-locale-es": minor
"@cosmicdrift/kumiko-locale-fr": minor
"@cosmicdrift/kumiko-locale-it": minor
---

The template editor exposes the letter features: the image bubble sets the print width and alignment, the divider bubble sets color and weight, the table toolbar adds and removes plain rows (a row under the repeat row prints once), and the layout settings offer a table line color, fold marks, header/footer on page 1 switches and corner marks; the table toolbar sets cell padding, width, alignment and the lines above and below the cursor row, and the placeholder bubble switches a date between short and long. The layout settings also take a paper color (`paperColor`, `#rrggbb`, reset to white) that tints the whole printed page, margins, header and footer included, and the editor paper. The editor paper draws the image size, alignment, divider style and fold marks, and dims a header or footer that starts on page 2.

<!-- kumiko-changes
feature: template-resolver
type: improvement
title: Editor controls for letter features
detail: The content editor bubble gains image width in mm and left/center/right alignment (plus the existing full-bleed switch in layout regions) and a divider bubble with color and weight. The table toolbar gets add-row and remove-row buttons; a row added under the repeat row is a plain row. The pdf-layout settings gain table line color, fold marks and header/footer on page 1 switches; the layout paper shows fold marks on the left edge and dims a region that starts on page 2.
-->
