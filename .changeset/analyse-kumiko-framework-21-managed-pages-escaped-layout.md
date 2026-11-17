---
"@cosmicdrift/kumiko-bundled-features": minor
---

A custom managed-pages `wrapLayout` receives only escaped and sanitized parts instead of raw tenant values.

<!-- kumiko-changes
feature: managed-pages
type: breaking
title: Custom managed-pages layouts get escaped parts only
detail: A custom `wrapLayout` used to receive the page title, description, language, slug, OG image and the tenant branding raw, and was trusted to escape them itself; a naive template string turned a tenant admin's branding title into markup on the public page. It now receives `bodyHtml`, `titleHtml`, `descriptionHtml`, `langHtml`, `slugHtml`, `ogImageHtml` (empty unless it is an https URL), `brandingStyleHtml` (theme variables plus the sanitized tenant CSS) and `brandingHeaderHtml`, all escaped or sanitized, so every field can be interpolated as is. The default layout is unchanged.
migration: Rewrite a custom managed-pages `wrapLayout` to the new fields: `title` becomes `titleHtml`, `lang` becomes `langHtml`, `description` becomes `descriptionHtml`, and `brandingStyleBlock(o.branding)`, `tenantStyleBlock(o.branding.customCss)` and `brandingHeaderHtml(o.branding)` become `o.brandingStyleHtml` and `o.brandingHeaderHtml`. Keep `TENANT_CONTENT_ATTR` on the content container.
affects: wrapLayout, brandingStyleBlock, tenantStyleBlock, brandingHeaderHtml
-->
