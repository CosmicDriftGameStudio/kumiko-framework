---
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

Renderer review fixes: the file View action no longer opens the clicked row, badge cells follow the column renderer, dashboard lists honour `emptyPlaceholder`, phone steps keep their further actions, guidance actions never send a step key as record id, summary footer keys are unique, and the page editor no longer asks to discard after a successful save.

<!-- kumiko-changes
feature: renderer
type: fix
title: Renderer review fixes for file view, badge cells, dashboard lists, steps and the page editor
detail: The PDF View action and its drawer stop click propagation so a row click does not fire. A badge or button column shows the same text as the cell without display (lookup renderer, FormatSpec) and only computes it when needed. Dashboard list columns honour emptyPlaceholder false. Steps keep their further actions in their own row below sm. Payload-less write and client actions of guidance items are left out when the shown record id is unknown. Summary footer cells get unique keys. The managed-pages editor reports clean right after a successful save and computes its initial draft once.
-->
