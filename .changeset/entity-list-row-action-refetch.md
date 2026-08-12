---
"@cosmicdrift/kumiko-renderer": patch
---

`entityList` and projection-list row-actions and toolbar-actions with `kind: "writeHandler"` (default) now refetch the rows query after a successful `dispatcher.write()`. Previously, a row/toolbar action that writes successfully but stays on the page (no `navigate` target) left the list showing stale data — the write went through, the projection updated, but nothing re-ran the rows query. Actions with a `navigate` target hid the bug because the screen remount reloaded everything. A failed write still does not refetch.
