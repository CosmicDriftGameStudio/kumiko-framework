---
"@cosmicdrift/kumiko-headless": patch
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-renderer-web": patch
---

Reference fields and columns link to the referenced record

<!-- kumiko-changes
feature: renderer
type: improvement
title: Reference fields and columns link to the referenced record
detail: A resolved reference in a list column or a read-only field links to the detail screen of the referenced entity when the user may open it, so the link also works in a new tab. Unresolved ids, system labels, multi-reference list cells and cells in a clickable first column or card stay plain text. New useOptionalNav hook returns undefined without a NavProvider.
-->
