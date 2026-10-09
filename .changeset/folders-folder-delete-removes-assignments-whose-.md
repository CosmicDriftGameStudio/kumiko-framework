---
"@cosmicdrift/kumiko-bundled-features": patch
---

folder:delete removes assignments whose host entity is gone instead of refusing forever

An assignment pointing at a hard-deleted, soft-deleted or unregistered host blocked folder:delete permanently with folder_has_assignments, because clear-folder needs a visible host and could not remove it. folder:delete now removes such assignments through the event-store executor (normal delete events) before the check, without the caller's read gate. Assignments of live hosts, including ones the caller cannot see, still block with folder_has_assignments. A refused delete removes nothing. The cleanup runs lazily at folder:delete, not in a host-delete hook, so restoring a soft-deleted host before then keeps its folder.

<!-- kumiko-changes
feature: folders
type: fix
title: folder:delete removes assignments whose host entity is gone instead of refusing forever
-->
