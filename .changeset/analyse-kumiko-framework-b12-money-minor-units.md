---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

Money is an integer in the currency's minor unit on every path. `createMoneyField` write payloads, zod schemas, events and read rows all carry `{ amount, currency }` with `amount` in minor units (cents for EUR, 0 decimals for JPY, 3 for BHD); `flattenMoney` no longer multiplies by 100 and rejects non-integer amounts and bare numbers, read rows drop `amountScaled`, and form derivations no longer convert. `toMinorUnits`/`toMajorUnits` take the currency and scale by `currencyDecimals`; `MINOR_UNIT_SCALE`, `moneyPayloadToMinorUnits` and `moneyAmountToMinor` are removed.

<!-- kumiko-changes
feature: money
type: breaking
title: Money amounts are integers in minor units everywhere
detail: Top-level money fields used major units on write and read while embedded rows, aggregates and template variables used minor units, and the database scaled by a flat 100 regardless of currency. Now every path carries the same integer in the currency's minor unit; only input widgets and formatters convert.
migration: Multiply every top-level money amount you send or seed by 10^decimals of its currency (×100 for EUR). Replace reads of `amountScaled`/`amountMinor` with `amount`. Remove own ×100/÷100 wire helpers. Pass the currency to `toMinorUnits(amount, currency)` and `toMajorUnits(amount, currency)`. Replace `moneyAmountToMinor(x, c)` with `toMinorUnits(x, c)` from `@cosmicdrift/kumiko-types`.
affects: all
-->
