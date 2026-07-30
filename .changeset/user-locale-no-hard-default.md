---
"@cosmicdrift/kumiko-bundled-features": patch
---

`user.locale` no longer defaults to `"de"` at the entity level — it stays unset until the client or a resolution chain (tenant-settings' `defaultLocale`, app fallback) provides one. The hardcoded default contradicted `tenant-settings`' own `"en"` default and silently overrode any app/tenant locale configuration for every new user (kumiko-framework#1637). Consumers that already fall back with `user.locale ?? "en"` (email templates, GDPR export mailers) are unaffected in shape but now see `null` instead of `"de"` for users who never set a locale — apps relying on the old implicit German default should set their own fallback explicitly.
