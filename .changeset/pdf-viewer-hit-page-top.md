---
"@cosmicdrift/kumiko-renderer": patch
---

A search hit in the PDF viewer opens with its page top in view, and the zoom label no longer wraps.

<!-- kumiko-changes
feature: renderer
type: fix
title: PdfViewer shows the page top of a search hit
detail: Stepping to a search hit used to center the hit, which left an empty frame above short pages. The viewer now brings the hit's page top into view and scrolls further only when the hit sits below the fold. The zoom label in the toolbar keeps "100 %" on one line at smaller root font sizes.
-->
