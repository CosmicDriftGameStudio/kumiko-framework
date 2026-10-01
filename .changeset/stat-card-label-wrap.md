---
"@cosmicdrift/kumiko-renderer-web": patch
---

StatCard no longer cuts a label mid-word next to a delta badge

The StatCard header row now wraps: when the label has no room for its longest word beside the delta chip (narrow cards on phones), the chip moves to its own line below icon and label. Wide cards keep the chip on the right in the same row.

<!-- kumiko-changes
feature: renderer-web
type: fix
title: StatCard header wraps so a delta badge no longer clips the label mid-word
-->
