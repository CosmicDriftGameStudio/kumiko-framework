---
"@cosmicdrift/kumiko-bundled-features": patch
---

Export `findReversedIds` from `ledger`. It was already exported from `./ledger/recurring`, but that module is not a public entry point of the package, so consumers could not deep-import it and had to reimplement reversal detection themselves.
