---
"@cosmicdrift/kumiko-renderer": minor
---

PdfViewer with `pagesOnly` shows each page whole (fit-page), and a folded phone thread can show a host-derived mail teaser.

<!-- kumiko-changes
feature: renderer
type: improvement
title: PdfViewer pagesOnly fits whole pages, ThreadMessage.teaser
detail: PdfViewer with pagesOnly now scales each page to the scroller's content height as well as its width (shrink-only), so a search hit opened in a host shows the page whole. ThreadMessage gains an optional teaser: while a foldOlderTogether thread has the mail closed, the plain-text teaser is shown clamped to clampLines lines with the "Read the whole mail" button; a click shows the full body.
-->
