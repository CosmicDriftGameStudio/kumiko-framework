---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-headless": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-renderer-web": minor
"@cosmicdrift/kumiko-types": minor
---

`createEmbeddedListField()` now has an editable widget, so line-item forms (invoices, bookings, orders) can be declared instead of hand-built as a custom screen. The field type gains `select`/`reference` cell types, `minItems`/`maxItems` bounds, derived cells (`multiply`/`sum`/`subtract`), and column totals; the new `EmbeddedListInput` renders it as a controlled table/card with add/remove/duplicate/reorder, keyboard navigation, and paste-from-spreadsheet support (fw#1838).
