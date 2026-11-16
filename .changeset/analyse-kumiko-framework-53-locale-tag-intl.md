---
"@cosmicdrift/kumiko-framework": patch
---

Locale tags that `Intl` rejects no longer count as valid, so `ctx.locale` can always be passed to `Intl.NumberFormat` and `Intl.DateTimeFormat`.

<!-- kumiko-changes
feature: i18n
type: fix
title: isValidLocaleTag rejects tags Intl cannot format with
detail: `isValidLocaleTag` checked only the shape of a tag. An `X-Locale: en-a` header, an Accept-Language tag such as `de-1` or a stored user locale of that kind therefore reached `ctx.locale`, and `Intl.NumberFormat` or `Intl.DateTimeFormat` threw a RangeError in every handler that formats with it. The check now also requires `Intl.getCanonicalLocales` to accept the tag. Such tags fall back like any other invalid locale, and the user, invite, waitlist and helpdesk payloads reject them with "invalid locale tag".
-->
