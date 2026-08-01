---
"@cosmicdrift/kumiko-framework": patch
---

A `number` field with `integer: true` now rejects values outside Postgres' `int4` range (-2147483648..2147483647) at the Zod schema boundary, returning a clean 400 instead of letting the write reach Postgres and crash with a 500 (22003). No behavior change for values already inside the int4 range.
