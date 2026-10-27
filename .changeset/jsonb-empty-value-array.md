---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-testing": minor
---

`createJsonbField({ emptyValue: "array" })` declares a jsonb field that holds an array: its column default is `'[]'::jsonb` instead of `'{}'::jsonb`, and writes accept an array instead of a plain object.

<!-- kumiko-changes
feature: framework
type: improvement
title: jsonb fields can default to an empty array
detail: A jsonb field that stores a list had the fixed column default `{}`, so a row that never wrote it read an object while every other row read an array, and the generated write schema only accepted plain objects. `emptyValue: "array"` switches the column default to `[]` and the write schema to an array; the default stays `"object"`. The schema migration renders `ALTER COLUMN ... SET DEFAULT '[]'::jsonb`; existing rows that never wrote the field get `[]` with the next rebuild of the projection.
-->
