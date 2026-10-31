---
"@cosmicdrift/kumiko-renderer": patch
---

The StatusBadge dot keeps its round shape when the badge text is truncated.

<!-- kumiko-changes
feature: renderer
type: fix
title: StatusBadge dot no longer squashes in a narrow badge
detail: A long badge text inside a width-limited container shrank the leading dot to a thin line. The dot now keeps its size and only the text is cut.
-->
