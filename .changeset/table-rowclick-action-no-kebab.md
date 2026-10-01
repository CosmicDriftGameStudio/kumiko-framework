---
"@cosmicdrift/kumiko-renderer-web": patch
---

List tables no longer render a one-item kebab for a row whose only action is the rowClick action

With a clickable row the `rowClick` action is no longer repeated in the row kebab, and a list left without menu actions gets no actions column. A row with an empty first cell keeps a screen-reader-only link labelled with the action. `"inline"` mode and editable cells are unchanged.

<!-- kumiko-changes
feature: renderer-web
type: fix
title: List tables no longer render a one-item kebab for a row whose only action is the rowClick action
-->
