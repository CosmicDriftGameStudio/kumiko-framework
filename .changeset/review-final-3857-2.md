---
"@cosmicdrift/kumiko-bundled-features": patch
---

Host-routing rejects a redirect whose `from` is an `/api` path at boot, because redirects only run for requests that reach the HTML fallback and such a rule would never fire.

<!-- kumiko-changes
feature: host-routing
type: fix
title: Redirects from /api paths fail at boot
detail: Redirects run inside hostDispatch after static files and API routes, so a from of /api or /api/... was silently dead config. Boot validation now throws; the options and README already describe the HTML-fallback scope.
-->
