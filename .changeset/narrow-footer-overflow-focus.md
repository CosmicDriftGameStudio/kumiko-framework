---
"@cosmicdrift/kumiko-renderer-web": patch
---

The narrow pinned footer's overflow menu no longer captures Escape and focus while closed

<!-- kumiko-changes
feature: renderer-web
type: fix
title: Escape closes a drawer again when its form has a narrow pinned footer, and the overflow menu focuses its first action
detail: The overflow popover content used to stay mounted while closed, so its dismiss layer took Escape away from the surrounding drawer or dialog and its focus scope never moved focus on open. The popover content now mounts only while open. The overflow actions stay mounted in a hidden host, so dialogs they own keep working.
-->
