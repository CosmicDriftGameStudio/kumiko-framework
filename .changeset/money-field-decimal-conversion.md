---
"@cosmicdrift/kumiko-framework": minor
---

**BREAKING:** `createMoneyField`'s `amount` now round-trips as **major units** (`56799.16` EUR) through the API — `flattenMoney`/`rehydrateMoney` convert to/from the underlying `BIGINT` column's **minor units** (cents) at the DB boundary. Previously the conversion didn't happen at all: the raw API `amount` was written straight into the `BIGINT` column, so a caller passing a decimal amount (e.g. `56799.16`) got a driver error on insert, and a caller passing a plain integer major-unit amount (e.g. `45000` meaning €450.00) had it silently stored as `45000` minor units — **100× too small** on read-back. The column's own doc comment ("storing the integer minor unit") always described this contract; the conversion code just never implemented it.

Any existing `createMoneyField` data written before this fix used the old (unconverted) semantics — for consumers with real deployed data, migrate stored amounts by multiplying by 100 before upgrading, or reconcile after. No known production deployment currently persists `money`-typed data (verified before merging this fix — solon and phronexsis are both pre-launch); this is a genuine break only for pending/future usage in those repos, not a live-data migration.
