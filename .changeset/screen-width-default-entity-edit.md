---
"@cosmicdrift/kumiko-renderer-web": patch
---

`createKumikoApp({ screenWidth })` now also applies to the default entityEdit form, which previously stayed at a fixed 640px column. Without the setting the column keeps its 640px width.

<!-- kumiko-changes
feature: renderer-web
type: fix
title: screenWidth setting now widens the default entityEdit form too
-->
