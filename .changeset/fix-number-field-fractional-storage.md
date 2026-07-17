---
"@cosmicdrift/kumiko-framework": minor
---

Fix `createNumberField()` DDL: the Postgres column type was hardcoded to
`integer` regardless of the `integer` flag, contradicting both the write-
boundary Zod validation (which accepts fractional values unless
`integer: true` is set) and the type's own doc comment ("no
migration/storage impact"). A field declared `createNumberField()` (no
`integer: true`) passed Zod validation for a fractional value but then
failed at the database with `invalid input syntax for type integer` on
insert — silently untested in practice for any entity whose values are
expected to be non-integer (e.g. Monte-Carlo simulation statistics).

`integer: true` now controls both the Zod validation AND the Postgres
column type: `true` → `integer` (unchanged), omitted/`false` → `double
precision` (was `integer`, now accepts fractional values).

**Breaking for existing entities**: any `createNumberField()` field
without `integer: true` changes its Postgres column type from `integer`
to `double precision` on the next migration. Existing integer data is
unaffected by the type widening (int4 → float8 is a safe, lossless
conversion), but the app's committed migration snapshot needs
regenerating (`kumiko schema apply` / equivalent) and reviewing before
deploy. Fields declared with `integer: true` are unaffected.
