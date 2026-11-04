---
"@cosmicdrift/kumiko-server-runtime": patch
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-samples": patch
---

The `pwa` option takes a `basePath`, so an app mounted below the origin root can be installed.

<!-- kumiko-changes
feature: renderer
type: improvement
title: pwa option: basePath for apps served under a path prefix
detail: `PwaOptions` gets `basePath` (default `/`, must start and end with `/`, same-origin, no empty, `.` or `..` segment, no `?` or `#`, otherwise the boot fails). The manifest is answered at `${basePath}manifest.webmanifest` and the worker at `${basePath}sw.js` (a worker only controls its own directory), `start_url`, `scope` and `id` are the base path, the shell precache and the offline fallback use `${basePath}`, and the head tags point at the prefixed paths; `/assets/*` stays at the root and cache-first, and so do the API paths (`/api`, `/sse`, `/auth`), so the ingress must route those to the app too. Each base path gets its own cache name prefix, so apps on one origin do not delete each other's precache. The web client registers the worker with the directory of the URL in `<meta name="kumiko-pwa-sw">` as scope instead of a fixed `/`. With the default base path nothing changes. `PWA_MANIFEST_PATH` and `PWA_SERVICE_WORKER_PATH` are no longer exported. Recipe: `samples/recipes/pwa-shell`.
-->
