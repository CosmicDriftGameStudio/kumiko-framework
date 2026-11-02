---
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-document-designer": patch
---

Screens can report the record they show through a neutral screen focus, and the sidebar's expanded state is changed only by the user.

<!-- kumiko-changes
feature: renderer
type: improvement
title: screen focus seam and user-owned sidebar state
detail: `ScreenFocusProvider` (mounted by `DefaultAppShell` and `WorkspaceShell`), `useSetScreenFocus(focus)` and `useScreenFocus()` let a screen report `{ entityName, recordId, label, facts? }`, compared by value and cleared on unmount; the PDF template editor reports its template. `useShellFocusMode()` no longer collapses or restores the sidebar. The sidebar's open state is kept in localStorage (`kumiko.sidebar.open`) and changes only through the user's own clicks; a collapsed sidebar on a focus screen still shows the focus rail.
-->
