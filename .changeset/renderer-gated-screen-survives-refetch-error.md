---
"@cosmicdrift/kumiko-renderer": patch
---

A screen gated by visibleWhen stays mounted when a live refetch of the gate query fails

<!-- kumiko-changes
feature: renderer
type: fix
title: A failed refetch of a visibleWhen gate no longer unmounts a screen that is already showing
detail: ScreenVisibilityGate used to fail closed on every error, so one failed live refetch (SSE reconnect, a short 5xx) removed the content and reset unsaved form input. Only the first evaluation fails closed now; after the content was shown, an error keeps it mounted as long as the last good data still matches the condition. The dashboard panel retry path is unchanged.
-->
