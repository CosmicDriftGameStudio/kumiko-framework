---
"@cosmicdrift/kumiko-framework": patch
---

`extractTableInfo` builds the field and column maps of a table once and reuses them.

<!-- kumiko-changes
feature: framework
type: improvement
title: Table info is cached per table meta
detail: `selectMany`, `updateMany`, `deleteMany`, `upsert` and the other query helpers called `extractTableInfo` on every query and rebuilt the field-to-column maps each time. The result is now cached per `EntityTableMeta` object; a table whose meta is replaced (for example by `declareSystemRowsReadable`) gets fresh info.
-->
