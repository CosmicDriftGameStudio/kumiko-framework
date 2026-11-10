---
"@cosmicdrift/kumiko-document-designer": patch
---

The PDF editor's loading state is visible and the inherited margins no longer jump.

<!-- kumiko-changes
feature: document-designer
type: fix
title: Visible loading state in the PDF template editor
detail: While the layout loads, the canvas shows skeleton rows on a white sheet; before, they had the colour of the canvas background and the editor looked empty. The "From layout" margin line appears once the layout is in instead of showing the default margins first.
-->
