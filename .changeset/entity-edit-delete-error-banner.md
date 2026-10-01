---
"@cosmicdrift/kumiko-renderer": patch
---

entityEdit screens show the server's reason when a delete is rejected

The reason (for example from a preDelete hook) now appears in the form-error banner instead of the confirm dialog closing silently. `RenderEdit`'s `onDelete` may return the rejected write's `DispatcherError` for this.

<!-- kumiko-changes
feature: renderer
type: fix
title: entityEdit screens show the server's reason when a delete is rejected
-->
