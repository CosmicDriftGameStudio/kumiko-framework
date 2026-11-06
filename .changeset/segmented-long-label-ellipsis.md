---
"@cosmicdrift/kumiko-renderer": patch
---

A segment label wider than its column ends in an ellipsis and stays readable as a tooltip.

<!-- kumiko-changes
feature: renderer
type: fix
title: Long segment labels end in an ellipsis instead of being clipped by the group
detail: A segment is now at most as wide as its group, cuts its label with an ellipsis and names the full label in title. Short labels look the same and segments still wrap to the next row.
-->
