---
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-bundled-features": patch
---

An app mounted under a URL prefix gets working default auth pages. `createKumikoApp({ basePath })` passes the prefix to the default nav adapter and exposes it to the auth gates through the new `BasePathProvider` / `useBasePath` (plus the pure `normalizeBasePath`, `stripBasePath`, `prependBasePath`). The default auth pages gate matches `/admin/unlock-account` and friends, and the login screen's default forgot-password and unlock links carry the prefix.

<!-- kumiko-changes
feature: renderer
type: improvement
title: basePath option for createKumikoApp and the auth pages
detail: createKumikoApp accepts basePath. The default auth pages gate matches its paths below the prefix, and the login screen builds its default forgot-password and unlock hrefs with it, so mail links to /admin/unlock-account no longer end on the login screen. New exports BasePathProvider, useBasePath, normalizeBasePath, stripBasePath and prependBasePath.
-->
