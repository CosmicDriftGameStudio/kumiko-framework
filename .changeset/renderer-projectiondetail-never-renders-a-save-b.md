---
"@cosmicdrift/kumiko-renderer": patch
---

projectionDetail never renders a Save button; extension tabs no longer repeat their title

A projectionDetail layout of only extension/relatedList sections synthesized a fieldless entity and drew a no-op Save. In layout.mode tabs, extension sections now honour hideSectionTitles like relatedList and writeForm.

<!-- kumiko-changes
feature: renderer
type: fix
title: projectionDetail never renders a Save button; extension tabs no longer repeat their title
-->
