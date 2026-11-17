---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-document-designer": patch
"@cosmicdrift/kumiko-locale-de": patch
"@cosmicdrift/kumiko-locale-es": patch
"@cosmicdrift/kumiko-locale-fr": patch
"@cosmicdrift/kumiko-locale-it": patch
---

Tenant branding moved from managed-pages into its own `branding` feature, so mail, PDF and the document designer get branding without public pages.

<!-- kumiko-changes
feature: branding
type: breaking
title: Branding is its own feature
detail: createBrandingFeature({ allowCustomCss }) registers the branding config keys (branding:config:title, description, site-url, accent-color, logo-url, logo-file, layout-preset, custom-css), the anonymous branding:query:tokens query, the branding:screen:branding-settings screen and brandingClient() translations; createBrandingCssFeature() gates custom CSS. managed-pages now requires branding and no longer exports BRANDING_QN, readBranding, MANAGED_PAGES_CSS_FEATURE, createManagedPagesCssFeature or the allowCustomCss option. The mail renderer and the document designer read the new keys and feature name.
migration: Mount createBrandingFeature() (with allowCustomCss and createBrandingCssFeature() where custom CSS was used) wherever managed-pages, mail branding or the document designer branding rail is used; import BRANDING_QN from @cosmicdrift/kumiko-bundled-features/branding; replace managed-pages:query:branding with branding:query:tokens and managed-pages:config:branding-* with branding:config:*; add brandingClient() to the client features. Stored values under the old keys are not carried over.
affects: managed-pages, BRANDING_QN, readBranding, MANAGED_PAGES_CSS_FEATURE, createManagedPagesCssFeature, allowCustomCss, renderer-mail-html, document-designer
-->
