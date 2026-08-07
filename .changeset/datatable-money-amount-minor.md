---
"@cosmicdrift/kumiko-renderer-web": patch
---

DataTable money cells prefer `amountMinor` from rehydrateMoney so major-unit `amount` is not passed to formatMoney (which expects cents).
