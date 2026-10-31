---
"@cosmicdrift/kumiko-renderer": patch
---

The PDF viewer can mark a passage without opening its search, its toolbar buttons are boxed, and badges match the inbox design.

<!-- kumiko-changes
feature: renderer
type: feature
title: PdfPreview marks a source passage with markTerm and keeps its search usable
detail: PdfPreview and PdfViewer take markTerm, for a passage such as the clause a step was read from. The viewer marks it on the page it opens on, keeps the page top in view instead of centering a search hit, and leaves its search toggle in the toolbar; a term typed into the search replaces the mark while it is set. The zoom and search buttons of the toolbar are now 28px bordered buttons. StatusBadge is 20px high instead of 22px, and a StepList tag that is too long for its column is cut with the full text as tooltip.
-->
