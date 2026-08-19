---
"@cosmicdrift/kumiko-framework": patch
---

Tenant-settings `locale` is now a select field backed by `DEFAULT_LOCALES` (`de`, `en`), matching how `currency` already works. Apps that need more locales pass `locales` to `createTenantSettingsFeature`. The freeform-text `pattern` validation is gone since the select constrains input already.
