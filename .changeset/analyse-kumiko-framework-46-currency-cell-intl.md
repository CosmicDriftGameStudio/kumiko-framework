---
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-samples": patch
---

The `currency` cell format takes an ISO 4217 code and formats the amount with Intl in the UI locale.

<!-- kumiko-changes
feature: renderer
type: breaking
title: Currency cells format with Intl and an ISO currency code
detail: `{ format: "currency", currency: "EUR" }` renders an integer amount in the currency's minor unit (`4250` or `"4250"` for 42.50 EUR) through `Intl.NumberFormat` with the currency's decimals, grouping and symbol position of the UI locale, for example `1.234,50 €` in German and `€1,234.50` in English. An optional `locale` overrides the UI locale. The old `symbol` option is gone: it only appended the symbol to the raw value without grouping or decimals. A missing or malformed currency code or a non-numeric value renders the raw value.
migration: Replace `renderer: { format: "currency", symbol: "€" }` with `renderer: { format: "currency", currency: "EUR" }` (ISO 4217 code). The value is an integer in the currency's minor unit: multiply a major-unit amount by 10^decimals of its currency (×100 for EUR, ×1 for JPY, ×1000 for KWD).
affects: "currency"
-->
