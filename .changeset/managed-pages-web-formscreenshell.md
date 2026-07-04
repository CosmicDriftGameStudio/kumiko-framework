---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-renderer-web": patch
---

managed-pages: add a `./managed-pages/web` client export (`managedPagesClient()`) so apps can register the feature's admin-screen translations into the browser i18n store. Previously the server-side `r.translations` bundle never reached the client, so configEdit/entityEdit labels (branding, page CMS) rendered as raw i18n keys in the admin UI. The client bundle is pivoted from the same `MANAGED_PAGES_I18N` source (no key duplication).

renderer-web: extract a shared `FormScreenShell` primitive — the canonical centered `max-w-3xl` form/settings column that `DefaultForm` (configEdit/entityEdit) already used. Exporting it lets custom settings screens share the exact same width + centering instead of each author re-inventing the wrapper. `user-data-rights`' privacy-center screen adopts it.
