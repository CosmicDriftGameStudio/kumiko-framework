---
"@cosmicdrift/kumiko-headless": minor
---

headless exports formatMoney and resolveSafeMoneyLocale

<!-- kumiko-changes
feature: headless
type: improvement
title: formatMoney and resolveSafeMoneyLocale move into headless
detail: formatMoney(amountMinor, currency, locale?, fractionDigits?) and resolveSafeMoneyLocale(locale) are exported from @cosmicdrift/kumiko-headless so server code such as the mail renderer formats money like the web client; renderer-web's formatMoney delegates to it.
-->
