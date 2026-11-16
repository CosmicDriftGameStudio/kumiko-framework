---
"@cosmicdrift/kumiko-renderer": patch
---

Apps with static marketing pages per locale can route apex requests through their locale router instead of a hand-written path matrix.

<!-- kumiko-changes
feature: renderer
type: improvement
title: Locale router dispatches static pages
detail: `createLocaleRouter(...)` from `@cosmicdrift/kumiko-renderer/headless/locale-routing` now returns `staticPageDispatch(pathname, fileFor)`. A canonical page path (with or without trailing slash) answers `{ kind: "html", file }` from `fileFor(page, locale)`, or `null` when `fileFor` returns `undefined`. A `localeHints` path and a path carrying the unprefixed default locale's prefix (for example `/en/features` when `en` is the default) answer a 301 redirect to the canonical path. Every other path answers `null`, so the host dispatch can fall through to the app.
-->
