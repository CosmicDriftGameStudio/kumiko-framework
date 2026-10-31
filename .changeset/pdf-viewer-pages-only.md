---
"@cosmicdrift/kumiko-renderer": patch
---

The PDF viewer can show just its pages, without thumbnail rail and toolbar.

<!-- kumiko-changes
feature: renderer
type: feature
title: PdfPreview shows only the pages with pagesOnly
detail: PdfPreview and PdfViewer take pagesOnly. The viewer then drops its thumbnail rail and toolbar and keeps the pages on the sand frame, for hosts that step through search hits with their own controls, such as a search result that opens a document on its hit. searchTerm and matchIndex work as with hideSearchBar.
-->
