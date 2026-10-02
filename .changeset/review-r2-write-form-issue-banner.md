---
"@cosmicdrift/kumiko-renderer": patch
---

A writeForm section keeps its error banner when the server reports an issue no rendered field can show (`version`, `id`, a root-level refine, a hidden field), instead of failing the save without any visible message.

<!-- kumiko-changes
feature: renderer
type: fix
title: writeForm section shows the error banner for issues no rendered field can display
-->
