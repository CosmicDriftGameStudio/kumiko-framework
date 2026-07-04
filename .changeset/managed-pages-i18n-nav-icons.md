---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-renderer-web": patch
---

managed-pages: ship de/en translations for its admin screens (branding settings + page CMS) via `r.translations`, so field labels, section headers and screen titles no longer render as raw i18n keys. Any app mounting `managed-pages` now boots with a complete, translated admin surface. Also adds `tag` and `key` to the nav-icon allowlist (`NAV_ICONS`) so nav entries using those keys render a Lucide icon instead of the grey dot fallback.
