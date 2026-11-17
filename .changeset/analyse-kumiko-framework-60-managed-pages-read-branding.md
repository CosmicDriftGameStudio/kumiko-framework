---
"@cosmicdrift/kumiko-bundled-features": patch
---

`readBranding` is exported from `@cosmicdrift/kumiko-bundled-features/managed-pages`.

<!-- kumiko-changes
feature: managed-pages
type: improvement
title: readBranding is public
detail: Apps that render their own branded pages read the tenant's managed-pages branding with `readBranding(ctx.config)` from `@cosmicdrift/kumiko-bundled-features/managed-pages` instead of reading the `BRANDING_QN` keys one by one. It returns the same tokens as the branding query (title, description, siteUrl, accentColor, logoUrl, logoFile, layoutPreset) with `customCss` left empty, and the defaults when the app has no config feature.
-->
