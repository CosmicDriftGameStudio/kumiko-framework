---
"@cosmicdrift/kumiko-types": patch
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-framework": patch
---

A list row action `kind: "drawer"` can open a `projectionDetail` in a wide drawer instead of a page.

<!-- kumiko-changes
feature: renderer
type: improvement
title: Open a projectionDetail in a drawer from a list row
detail: A rowAction `{ kind: "drawer", screen: "<projectionDetail id>", rowClick: true, width: "wide" }` opens the record's detail (tabs, related lists, header actions) in a drawer over the list; the row `id` is the record id. Related-list row actions of kind drawer open their actionForm in a second drawer. Closing the detail reloads the list. The `entity-list/detail-without-navigate` rule accepts such a rowClick drawer as the detail entry; `screen/drawer-target-not-action-form` allows a projectionDetail target from a rowAction.
-->
