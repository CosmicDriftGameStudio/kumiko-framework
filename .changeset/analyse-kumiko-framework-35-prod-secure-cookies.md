---
"@cosmicdrift/kumiko-server-runtime": minor
---

runProdApp writes Secure `__Host-` session cookies by default, independent of NODE_ENV.

<!-- kumiko-changes
feature: framework
type: breaking
title: runProdApp defaults to Secure session cookies
detail: `auth.secureCookies` in runProdApp now defaults to `true` instead of `NODE_ENV === "production"`, so a production image started without NODE_ENV no longer falls back to plain, non-Secure auth and CSRF cookies. An explicit `secureCookies: false` still wins. runDevApp and the test stack keep the NODE_ENV fallback.
migration: A runProdApp deployment served over plain http on a host other than localhost must set `auth.secureCookies: false`. Users of such a deployment log in once after the update.
affects: runProdApp, secureCookies
-->
