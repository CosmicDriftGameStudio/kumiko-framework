---
"@cosmicdrift/kumiko-renderer-web": patch
---

DetailList sizes its label column from the container

DetailList now sizes its label column from its own container width instead of the viewport, so it stacks correctly in narrow panels regardless of screen size.

<!-- kumiko-changes
feature: renderer-web
type: fix
title: DetailList sizes its label column from the container
-->

