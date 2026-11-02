---
"@cosmicdrift/kumiko-renderer": patch
---

Renderer polish: a collapsible section header grows with a wrapping title, the code input ignores insertions into a full code instead of auto-submitting a shifted one, column drags only persist when the target row changes, the overflow-menu action error disappears when the action returns to the toolbar, and the list export sends the client payload unchanged since the server alone sanitizes it.

<!-- kumiko-changes
feature: renderer
type: fix
title: code input, collapsible header, column drag and overflow error polish
detail: `CollapsibleSection` uses `min-h-9` so long titles are not clipped. `CodeInput` discards a change that would insert digits into an already full code, so no shifted code reaches `onComplete`. The column picker drag calls `onChange` only when the target index moves. Data table header cells carry `data-column-role` for width measurement instead of relying on test ids. Overflow-menu action errors render only while the action lives in the overflow menu. The list export no longer strips paging keys client-side; `sanitizeExportPayload` on the server is the only trust boundary.
-->
