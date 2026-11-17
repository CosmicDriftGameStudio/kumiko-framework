---
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

`formatMoney(amountMinor, currency, options)` and `formatMoneyValue(value, options)` take an options object with `locale`, `minimumFractionDigits`, `maximumFractionDigits`, `signDisplay` and `notation` instead of positional `locale` and `fractionDigits`. An unknown currency code now formats the amount as a plain decimal instead of printing the raw minor integer.

<!-- kumiko-changes
feature: renderer-format
type: breaking
title: formatMoney takes an options object
detail: Apps wrote their own money formatters for whole-euro display, compact notation and hiding the sign of a rounded zero. formatMoney now covers these through Intl options.
migration: Replace `formatMoney(minor, currency, locale, digits)` with `formatMoney(minor, currency, { locale, minimumFractionDigits: digits, maximumFractionDigits: digits })` and `formatMoneyValue(value, locale)` with `formatMoneyValue(value, { locale })`. Replace own compact or no-sign-zero money formatters with `notation: "compact"` and `signDisplay: "negative"`.
affects: formatMoney
-->
