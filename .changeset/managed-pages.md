---
"@cosmicdrift/kumiko-bundled-features": minor
---

managed-pages: new framework capability for tenant-editable, server-rendered public pages with per-tenant branding and tier-gated, allowlist-sanitized custom CSS.

- A `page` entity (`read_pages`, keyed `(tenantId, slug, lang)`) with a `published` gate plus `description`/`ogImage` SEO meta, authored via TenantAdmin/SystemAdmin `entityList`/`entityEdit` screens and convention CRUD.
- An anonymous `GET {basePath}/:slug` route that resolves the tenant from the request Host via an app-supplied `resolveApexTenant`, serves only published pages (drafts → 404), renders Markdown through the hardened `page-render` core (raw HTML escaped), and isolates per-tenant content with `Vary: Host`.
- Per-tenant branding `config` keys (`branding-{title,description,site-url,accent-color,logo-url,layout-preset}`) with write-time validation (hex color, https URLs) and a `configEdit` self-service screen; applied at render as scoped `:root` vars + a logo/title header.
- Opt-in `allowCustomCss` (default false, fail-closed): a raw per-tenant CSS key emitted as a scoped, allowlist-sanitized `<style data-tenant-css>` block — `@import`/`url()`/`expression()`/`</style>`-breakout/scope-escape closed by construction, paint clipped to the content box. Gated per-tenant by the companion `managed-pages-css` toggle (`createManagedPagesCssFeature`). `tenantStyleBlock`/`TENANT_CONTENT_ATTR` are exported so a custom `wrapLayout` emits tenant CSS with the same containment.

Also: the feature-manifest now carries the `pattern` validator on text config keys. `ConfigKeyDefinition.pattern`'s JSDoc already promised JSON survival (feature-manifest, docgen), but the manifest serializer was dropping the field — it now surfaces hex/https/length format constraints in the generated manifest.
