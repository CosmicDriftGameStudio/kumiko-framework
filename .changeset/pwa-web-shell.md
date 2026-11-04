---
"@cosmicdrift/kumiko-server-runtime": patch
"@cosmicdrift/kumiko-dev-server": patch
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-locale-de": patch
"@cosmicdrift/kumiko-locale-es": patch
"@cosmicdrift/kumiko-locale-fr": patch
"@cosmicdrift/kumiko-locale-it": patch
"@cosmicdrift/kumiko-samples": patch
---

Web apps can be installed as a PWA and keep their shell offline through one `pwa` option on `runProdApp` and the dev server.

<!-- kumiko-changes
feature: renderer
type: improvement
title: pwa option: web manifest, own service worker, one-time install hint
detail: `runProdApp`, `runDevApp` and `createKumikoServer` take `pwa: { name, shortName, themeColor, backgroundColor, icons: [{ src, sizes, type?, purpose? }] }` (type `PwaOptions` from `@cosmicdrift/kumiko-server-runtime/pwa`); pass it to both servers. Icon `src` must be a same-origin path, otherwise the boot fails; in production `pwa` needs `staticDir`. The server answers `GET /manifest.webmanifest` (`application/manifest+json`) and a generated `GET /sw.js` (`no-cache`), both ahead of app routes and files, and adds manifest link, theme-color, Apple home-screen tags, apple-touch-icon and `<meta name="kumiko-pwa-sw">` to every HTML shell. The worker precaches `/`, manifest, icons and the build's bundles under a cache name derived from build id, bundles and options, serves `/assets/*` cache-first, other shell files network-first, navigations network-first with the cached shell only when offline, and never handles `/api/`, `/sse/`, `/auth/`, SSE, non-GET or cross-origin requests; activate drops older `kumiko-pwa-` caches. The web client registers the worker only when the meta is present and shows a dismissible one-time install hint (iOS: Share then Add to Home Screen; elsewhere the deferred `beforeinstallprompt`), never when running standalone. New i18n keys `kumiko.pwa.install-hint`, `kumiko.pwa.install-hint-ios`, `kumiko.pwa.install`, `kumiko.pwa.dismiss` in en, de, es, fr, it. Without `pwa` nothing changes and existing service workers stay registered. `/manifest.json` remains the build's asset map. Recipe: `samples/recipes/pwa-shell`.
-->
