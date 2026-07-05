---
"@cosmicdrift/kumiko-bundled-features": patch
---

page-render: neuer `./page-render/web`-Subpath für client-safe Exports (renderSafeMarkdown, sanitizeTenantCss, wrapInLayout, branding-Helpers, securePageHeaders). Der bestehende `./page-render`-Barrel re-exportierte auch `cachedSecurePageResponse`, das transitiv `@cosmicdrift/kumiko-framework/api` (postgres/ioredis) zieht — jeder Import aus dem Barrel in Client-Code ließ den Browser-Bundle mit "Bundle failed" crashen, ohne brauchbare Fehlermeldung.
