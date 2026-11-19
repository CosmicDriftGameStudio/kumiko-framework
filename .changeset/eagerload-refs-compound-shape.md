---
"@cosmicdrift/kumiko-framework": minor
---

Eager-loaded references in `_refs` now carry money and located timestamp fields in the same shape as the referenced record's own detail, and a money field the caller may not read no longer leaves its currency behind.

<!-- kumiko-changes
feature: framework
type: breaking
title: _refs carry money and located timestamps in the detail shape
detail: A referenced row in `_refs.<field>` used to hold a money field as the raw minor-unit amount (a `bigint` in process) next to a separate `<field>Currency`, and a located timestamp as `<field>Utc` plus `<field>Tz`. A handler result carrying such a `_refs` row failed in `JSON.stringify`. The row now has the shape the referenced entity's detail query returns: `{ amount, currency }` for money, `{ at, tz, utc }` for a located timestamp, without the companion columns. A money or located timestamp field the caller may not read is absent as a whole; before, its `<field>Currency`, `<field>Utc` or `<field>Tz` column still came through.
migration: Code that reads `_refs.<ref>.<money>` as a number or `_refs.<ref>.<money>Currency` reads `_refs.<ref>.<money>.amount` and `.currency`; code that reads `_refs.<ref>.<ts>Utc` or `<ts>Tz` reads `_refs.<ref>.<ts>.utc` and `.tz`.
affects: _refs, enrichWithReferences, enrichRowWithReferences, EagerloadedRow
-->
