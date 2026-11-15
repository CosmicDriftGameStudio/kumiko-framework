---
"@cosmicdrift/kumiko-renderer": patch
---

An action-form preview that shows facts no longer adds the "No entries yet." box under them when its list is empty; a preview with only a list keeps the empty state. The shared editor workbench also drops the duplicate save button in its header (the footer carries it) and, below the `md` breakpoint, scrolls editor and rail as one surface.

<!-- kumiko-changes
feature: renderer
type: fix
title: Action-form preview hides an empty list next to facts
detail: `preview.list` renders only when it has rows or the preview has no `facts`, so a preview with facts and an empty list (for example a contract PDF with no rent steps) no longer shows a dashed "No entries yet." box. `EditorWorkbench` no longer renders save buttons in the page header (they were a second copy of the footer's, shown from 1280px up); `EditorHeader` takes `actions` as optional.
-->
