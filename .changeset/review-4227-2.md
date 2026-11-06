---
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-server-runtime": patch
---

An app that drops the `pwa` option no longer leaves its old service worker running in users' browsers.

<!-- kumiko-changes
feature: renderer
type: fix
title: Dropping the pwa option retires the leftover service worker
detail: Without the shell meta, the web client unregisters the service worker for its own scope when it is served as `/sw.js` and a `kumiko-pwa-` cache exists, then deletes those caches. App-owned workers have no such cache and stay untouched. `PWA_CACHE_NAME_PREFIX` now lives in the renderer headless entry and is re-exported by the server runtime script module.
-->
