---
"@cosmicdrift/kumiko-document-designer": patch
---

The mail preview fills the editor column instead of a fixed 560px box

<!-- kumiko-changes
feature: document-designer
type: fix
title: Mail preview fills the editor column
detail: The preview frame (HTML and plain text) had a fixed height of 560px, so long mails were cut off mid-sentence with an empty grey area below. The frame now grows with the center column (at least 420px) and scrolls inside.
-->
