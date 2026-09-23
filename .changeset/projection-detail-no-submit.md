---
"@cosmicdrift/kumiko-renderer": patch
---

`projectionDetail` screens are read-only and no longer render a Save button. Previously, a layout with only `extension` and `relatedList` sections showed a Save button that did nothing when clicked. With no fields section, the synthesized entity had no fields, so the screen was treated like a fieldless submit form.

In `layout.mode: "tabs"`, an `extension` section no longer repeats its title under its own tab label. `relatedList` and `writeForm` sections already worked this way.
