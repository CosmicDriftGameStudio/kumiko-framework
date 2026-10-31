---
"@cosmicdrift/kumiko-renderer": minor
---

StepList can fold a filling list only when its steps overflow, a hidden Field label no longer shifts its control, and collapsed thread rows show a chevron.

<!-- kumiko-changes
feature: renderer
type: improvement
title: StepList collapseWhen "overflow", hidden Field label without gap, thread row chevron, PdfViewer scroll padding
detail: StepList gains collapseWhen ("always" by default, the old behaviour). With "overflow" a fill list with collapsedAfter shows every step while they fit its height and folds only when they do not, then shows as many steps as fit but at least collapsedAfter. A Field with hideLabel and no changed marker, appendix or status no longer renders an empty label row, so its control is not pushed down by the column gap and lines up with a button beside it. Collapsed earlier mails in MessageThread show a chevron, a hover background and a pointer cursor. PdfViewer keeps its padding above a page it jumps to (scroll-padding), so the page no longer touches the toolbar.
-->
