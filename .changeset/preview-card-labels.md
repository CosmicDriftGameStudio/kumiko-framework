---
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-types": patch
---

actionForm preview: phone cards label every value, right-align labeled amounts, and the preview list columns get `emphasize` and `hideZeroOnCard`.

<!-- kumiko-changes
feature: renderer
type: fix
title: Preview cards on a phone read like a small calculation
detail: The preview table of an actionForm turns into cards on a narrow screen, where no column header is visible. Each value now shows its column label. Every `cardLabel` column of number or money type on its own card line, in any DataTable including entityList screens, now puts the name left and the figure right-aligned, like the totals card; labeled text and narrowInline values keep "Label: value". Two new options on a preview list column: `emphasize` draws the row's result bold with a rule above it on the card, `hideZeroOnCard` leaves a zero amount off the card while the table keeps it. Put signs in the labels ("− Paid", "= Open") and a card reads as rent minus payments equals open.
-->
