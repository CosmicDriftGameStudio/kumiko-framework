---
"@cosmicdrift/kumiko-renderer-web": patch
---

Fix `EmbeddedListInput` desktop table columns clipping date and money values (e.g. a trailing digit or the currency sign cut off). `columnWidthClass` gave `date`/`number`/`decimal`/`money`/`timestamp` a fixed width too narrow for the calendar button and money's stepper padding; each now gets a `min-w` floor sized for its own control instead. Timestamp columns are noticeably wider as a result (176px → 304px); number/decimal are unchanged.
