---
"@cosmicdrift/kumiko-renderer-web": patch
---

Fixed `defaultCellRender` formatting money table cells incorrectly for currencies with a decimal precision other than 2. It previously preferred `amountMinor` (scaled by a flat `MINOR_UNIT_SCALE=100`) over deriving minor units from `amount`, which disagreed with `currencyDecimals(currency)` — e.g. JPY (0 decimals) rendered 100x too high, BHD (3 decimals) 10x too low. Minor units are now always derived from `amount` and `currencyDecimals(currency)`, consistent with `render-field.tsx`'s `moneyMinorValue`.

Also: `DefaultSection` now supports the renderer's new `hidden` prop (keeps wizard steps mounted instead of unmounting them), and `DefaultInput` now forwards the renderer's new `step` prop for number inputs.
