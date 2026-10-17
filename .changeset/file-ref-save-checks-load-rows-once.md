---
"@cosmicdrift/kumiko-framework": patch
---

A save with file fields loads its fileRef rows once

<!-- kumiko-changes
feature: framework
type: improvement
title: A save with file fields loads its fileRef rows once
detail: The tenant check and the pending-upload binding of a save each read every named fileRef row inside the write transaction. They now share one query over the ids, restricted to the writer's tenant and live rows. Values that are not UUIDs are still skipped.
-->
