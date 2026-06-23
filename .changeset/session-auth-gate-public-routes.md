---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-renderer-web": patch
"@cosmicdrift/kumiko-dev-server": patch
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-headless": patch
"@cosmicdrift/kumiko-dispatcher-live": patch
---

Session bootstrap only mounts behind SessionAuthGate so public SPA gates (e.g. `/rechner`) no longer call `/api/auth/tenants`. Skip refresh when no `kumiko_csrf` cookie is present.
