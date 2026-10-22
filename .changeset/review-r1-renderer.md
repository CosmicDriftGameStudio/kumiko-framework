---
"@cosmicdrift/kumiko-renderer": patch
---

Renderer fixes: no false "Unknown" reference labels from capped lookups, sortable related-list columns, existing dropzone files, markSaved no longer hides unsaved input, actionForm reload after reset, dashboard gate flicker and key collisions.

<!-- kumiko-changes
feature: renderer
type: fix
title: Renderer review fixes for lookups, dropzone, markSaved, actionForm reset and dashboard gates
detail: Reference labels show "Unknown" only when the lookup page was complete; a related-list column keeps sortable on fields without a sortable key; a files dropzone lists and can remove files already in the value; extension markSaved accepts the written field names, no longer clears other sections' dirty state; an actionForm with load and resetOnSuccess reloads the record before resetting; fallback panels no longer flash before the visibility gate answers; identical text blocks get unique keys; the missing-screen warning names the route id.
-->
