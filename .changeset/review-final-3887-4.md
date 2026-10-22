---
"@cosmicdrift/kumiko-renderer": patch
---

Leaving a dirty form via browser Back or Forward no longer writes the target URL twice into the history. A confirmed leave steps back with `history.back()` instead of `replaceState`, and a second Back or Forward while the dialog is open is undone instead of stacking another entry or replacing the open request.

<!-- kumiko-changes
feature: renderer
type: fix
title: Leave guard keeps the history clean on Back and Forward
detail: Confirming the leave dialog after a browser Back or Forward now uses history.back(), so the target is no longer duplicated in the history stack. Popstate events that arrive while a leave request is open restore the URL and leave the open dialog untouched.
-->
