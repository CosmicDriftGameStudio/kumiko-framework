---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-renderer": patch
---

Eager-loaded references in `_refs` now carry money and located timestamp fields in the same shape as the referenced record's own detail, and a money field the caller may not read no longer leaves its currency behind. A reference label that is money or a located timestamp shows the formatted value.

<!-- kumiko-changes
feature: framework
type: breaking
title: _refs carry money and located timestamps in the detail shape
detail: A referenced row in `_refs.<field>` used to hold a money field as the raw minor-unit amount (a `bigint` in process) next to a separate `<field>Currency`, and a located timestamp as `<field>Utc` plus `<field>Tz`. A handler result carrying such a `_refs` row failed in `JSON.stringify`. The row now has the shape the referenced entity's detail query returns: `{ amount, currency }` for money, `{ at, tz, utc }` for a located timestamp, without the companion columns. A money or located timestamp field the caller may not read is absent as a whole; before, its `<field>Currency`, `<field>Utc` or `<field>Tz` column still came through.
migration: Code that reads `_refs.<ref>.<money>` as a number or `_refs.<ref>.<money>Currency` reads `_refs.<ref>.<money>.amount` and `.currency`; code that reads `_refs.<ref>.<ts>Utc` or `<ts>Tz` reads `_refs.<ref>.<ts>.utc` and `.tz`.
affects: _refs, enrichWithReferences, enrichRowWithReferences, EagerloadedRow
-->

<!-- kumiko-changes
feature: renderer
type: fix
title: Reference columns format a money or located timestamp label
detail: A reference column or reference field whose label field is a money or located timestamp field showed "[object Object]", both for eager-loaded `_refs` rows and for labels from the lookup query. It now shows the formatted amount or timestamp.
-->
