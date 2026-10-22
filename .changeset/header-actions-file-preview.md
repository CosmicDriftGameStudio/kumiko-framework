---
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-types": minor
---

Lists put every primary toolbar action into the page header, and file lists can open the first PDF preview by default.

<!-- kumiko-changes
feature: renderer
type: improvement
title: All primary toolbar actions move into the list page header
detail: Previously at most one primary toolbar action was promoted, and only when the list had no create button. Now every primary action without a confirm dialog sits in the page header, left of the create button (which stays rightmost), in declaration order. Promoted actions no longer appear in the list toolbar. On phones they become entries of the header overflow menu when a create button is present, so the create button keeps its place.
-->

<!-- kumiko-changes
feature: renderer
type: improvement
title: renderer { format: "file", previewOpenByDefault: true } opens the first PDF preview
detail: FileValueList takes a previewOpenByDefault prop, set declaratively through the file renderer spec, so the inline preview of the first file starts open. The preview is only mounted for PDFs. Without the option the toggle behaves as before.
-->
