---
"@cosmicdrift/kumiko-framework": patch
---

Multi-stream projection rebuilds skip archived streams, like single-stream rebuilds already do.

<!-- kumiko-changes
feature: framework
type: fix
title: MSP rebuild ignores archived streams
detail: Rebuilding a multi-stream projection replayed every subscribed event, including events of streams in `kumiko_archived_streams`, so archived data came back into the read model. The rebuild now uses the same archive filter as the single-stream rebuild.
-->
