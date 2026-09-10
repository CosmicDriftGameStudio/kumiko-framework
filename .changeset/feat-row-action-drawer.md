---
"@cosmicdrift/kumiko-framework": minor
---

fw#2710: `RowAction` gains a third variant, `kind: "drawer"`, alongside `navigate` and `writeHandler` — the row-level counterpart to `ToolbarAction`'s `kind: "drawer"` (fw#2225). It references an `actionForm` screen by id and an optional `params` extractor that prefills the form from the clicked row's own values. Clicking the row action mounts that actionForm inline in the same shared slide-in Drawer used by toolbar actions, instead of navigating to a full page. A successful submit closes the Drawer and reloads the underlying screen; Cancel closes it without navigating.

Supported at every `RowAction` call site: `entityList.rowActions`, `projectionList.rowActions`, `projectionDetail.actions`, `entityEdit.actions`, and `relatedList` sections' `rowActions`. The boot validator rejects a `screen` reference that doesn't resolve to a same-feature `actionForm` screen, mirroring the `ToolbarAction` drawer check.
