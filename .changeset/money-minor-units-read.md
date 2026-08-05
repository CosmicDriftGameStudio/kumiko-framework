---
"@cosmicdrift/kumiko-framework": patch
---

`rehydrateMoney` now includes `amountMinor` (exact integer cents) alongside `amount`/`currency` on every read (`detail()`, `list()`). Callers that need cent-exact comparisons (e.g. invoice line-item sums) can use `amountMinor` instead of round-tripping the float `amount` through `/100`/`*100`, which isn't lossless for every value (fw#1830).
