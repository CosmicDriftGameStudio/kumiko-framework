---
"@cosmicdrift/kumiko-renderer": patch
---

projectionDetail without a fields section no longer shows a no-op Save; extension tabs no longer repeat their title

A projectionDetail layout of only extension/relatedList sections synthesized a fieldless entity and drew a Save that did nothing. Extensions that register with the form host still get their Save. In layout.mode tabs, extension sections now honour hideSectionTitles like relatedList and writeForm.

<!-- kumiko-changes
feature: renderer
type: fix
title: projectionDetail without a fields section no longer shows a no-op Save; extension tabs no longer repeat their title
-->
