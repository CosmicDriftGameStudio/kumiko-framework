---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-server-runtime": patch
"@cosmicdrift/kumiko-dev-server": patch
---

Fix tryHonoFirst masking a matched route's own deliberate 404 (e.g. default-deny reads) as the SPA shell with status 200. buildServer's `app.notFound()` now marks genuine router-misses with an internal-only header that tryHonoFirst — and every passthrough that bypasses it — uses to tell the two cases apart; the marker never reaches a client.

Closes #2435
