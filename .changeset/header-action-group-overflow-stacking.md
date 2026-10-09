---
"@cosmicdrift/kumiko-renderer-web": patch
---

App wrappers around `headerActions` are no longer restyled into a stacked column inside the phone overflow menu (the `[&>div]` child selector reached into app markup). Use the new `HeaderActionGroup` instead: a horizontal row in the header, a stacked column in the overflow menu

<!-- kumiko-changes
feature: renderer
type: improvement
title: HeaderActionGroup replaces the overflow menu child selector for header action wrappers
-->
