---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-renderer-web": minor
---

Dashboard panels: translatable texts, currency format, scrollable stacked-area

Query handlers can send `{ i18nKey, i18nParams? }` (`DashboardI18nText`) wherever a dashboard panel shows text: stat value and sub line, feed `primary`/`trailing`, progress-list `label`/`value`, chart marker labels. Plain strings are shown unchanged. Params may be strings, numbers, nested `DashboardI18nText` (resolved first, e.g. a duration built from two plural keys), `{ kind: "money", amountMinor, currency }` (user locale) or `{ kind: "date", atMs }` (medium date, user time zone).

`valueFormat: { kind: "currency", currency, fractionDigits? }` on stat and chart panels formats minor-unit values as currency in stat values, y ticks, legend totals and tooltips. `scrollable: true` on a `stacked-area` chart gives each bucket a fixed width, scrolls the plot horizontally with the y ticks fixed on the left, and opens at "today". The boot validator rejects an invalid currency code, `fractionDigits` outside 0..4 and `scrollable` on other chart kinds. `formatMoney` takes an optional `fractionDigits`.

<!-- kumiko-changes
feature: renderer-web
type: improvement
title: Dashboard panel texts are translatable (i18nKey/i18nParams with nested, money and date params), panels get a currency valueFormat and stacked-area charts can scroll
-->
