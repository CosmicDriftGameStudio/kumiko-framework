---
"@cosmicdrift/kumiko-framework": minor
---

feat(entity): read-time derived (computed) fields for entityList

`EntityDefinition.derivedFields` declares named values computed per row from the
stored columns + the clock at query time — never persisted, no DB column, never
writable. A declarative `entityList` can name a derived field as a column like
any other; the list-query handler appends the computed value to each row. This
removes the need to fork a whole custom screen just because one column is
live-computed.

Author with `createDerivedField({ valueType, derive, sortable? })`; `derive`
takes its clock from `ctx.asOf` (no-date-api safe, unit-testable). Derived
columns are display + client-side sort only — server-side sort/filter/search
apply to stored columns, so for those, materialize the value as a real field.
