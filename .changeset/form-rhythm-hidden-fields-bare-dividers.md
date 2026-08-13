---
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-renderer-web": patch
---

Two form-rendering rhythm fixes, both measured in a live DOM:

- `RenderEdit`'s field grid claimed a full grid row for every field, including fields hidden via `visible: false` (whose `RenderField` renders `null`). A form with several hidden fields in a row left visible empty gaps in the grid. `GridCellForField` now bails out before rendering the `GridCell` when the field isn't visible.
- `DefaultForm`'s bare branch (`BareFormProvider`, used by `AuthCard` and any consumer embedding a form without its own card) stacked `<section>`s with no divider between them, so a section boundary looked like a layout gap rather than structure. It now carries the same `[&>section:not(:first-child)]:border-t` rule as the carded branch. Flat-field forms (e.g. the auth screens, which render `Field`/`Banner`/`Button` directly with no `<section>`) are unaffected — verified across all `AuthCard` consumers in this repo.
