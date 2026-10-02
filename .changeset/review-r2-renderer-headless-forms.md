---
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-headless": patch
---

Form and list fixes. A scoped `validate()` entry such as `address.city` no longer reports sibling issues like `address.zip`. Root-level `.refine()` issues now show as a banner in `RenderEdit` instead of blocking submit silently. In tabs mode the active tab follows its id when a field change hides an earlier tab, and an explicit subtitle override is kept. An entityEdit update redirect with `idFrom` reads the saved projection, so a changed parent FK redirects to the new parent. A row-extractor key missing from the row no longer wipes the target field's default. `relatedList` client-side sorting orders numeric strings by value, puts empty values last and compares text locale-aware. A reference list facet warns in dev when the lookup hits its row cap.

<!-- kumiko-changes
feature: renderer
type: fix
title: Scoped validation matches exact paths, root refine issues are visible, tabs keep the active tab by id, update redirects use the saved FK, related list sorting handles numeric strings, nulls and locales
-->
