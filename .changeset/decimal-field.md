---
"@cosmicdrift/kumiko-framework": minor
---

feat(engine): add `createDecimalField` — exact `numeric(precision, scale)` column

A new field primitive for values that need fractional precision the integer
`number` field and the cents-based `money` field can't hold: interest rates,
percentages, ratios, measurements. `precision` and `scale` are required (no
truncating default). Stored as Postgres `numeric(p,s)`; pg returns it as a
string, which the centralized read-coercion surfaces as a JS `number` (safe ≤
2^53, same trade-off as `bigInt` mode:"number"). Write-boundary Zod validation
rejects over-scale / over-precision input instead of silently rounding.
