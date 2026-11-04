---
"@cosmicdrift/kumiko-types": patch
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-samples": patch
---

`projectionDetail` and `entityEdit` screens can ask for the focused shell with `focus: true`.

<!-- kumiko-changes
feature: renderer
type: improvement
title: Declarative focus for record screens
detail: `focus?: boolean` on `projectionDetail` and `entityEdit` (default off). A focused screen calls `useShellFocusMode()` for the renderer: the focus rail replaces the full sidebar and the app header actions leave the shell header. Below 768 px the shell header is hidden and the screen gets a `MobileTopBar` with the record title (screen title as fallback), a back arrow to the parent list screen (same resolution as the breadcrumb, browser history without a parent) and the page-header overflow items as menu. Recipe: `samples/recipes/record-detail-layout`.
-->
