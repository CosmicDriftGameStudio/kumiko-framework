---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-dispatcher-live": minor
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-dev-server": minor
"@cosmicdrift/kumiko-testing": minor
---

Session cookies written Secure and without a Domain attribute now use the `__Host-` prefix: `__Host-kumiko_auth`, `__Host-kumiko_csrf` and `__Host-kumiko_tenant`. A browser only accepts such a cookie when it is Secure, Path=/ and host-only, so a sibling subdomain can no longer set or shadow it. With `auth.cookieDomain` or without Secure the plain names stay. The new auth option `secureCookies` forces the Secure flag (default: `NODE_ENV === "production"`); buildServer resolves it once.

The base names and the naming rule live in `@cosmicdrift/kumiko-types/session-cookies` (`AUTH_COOKIE_BASE`, `CSRF_COOKIE_BASE`, `TENANT_COOKIE_BASE`, `sessionCookieName`, `resolveSessionCookieNames`). `readCsrfToken()` reads the prefixed csrf cookie first and falls back to the plain one.

<!-- kumiko-changes
feature: framework
type: breaking
title: Secure host-only session cookies use the __Host- prefix
detail: Auth, csrf and tenant cookies are named __Host-kumiko_auth, __Host-kumiko_csrf and __Host-kumiko_tenant when they are written Secure and without a Domain (the tenant cookie is always host-only). With auth.cookieDomain or without Secure the auth and csrf names stay kumiko_auth and kumiko_csrf. New auth option secureCookies forces Secure (default NODE_ENV === "production"). Login deletes the legacy unprefixed host-only cookies, logout and deleteTenantCookie delete the prefixed and the legacy names. The server reads only the resolved names, so a request that carries only the legacy kumiko_auth is anonymous. AUTH_COOKIE_NAME, CSRF_COOKIE_NAME and TENANT_COOKIE_NAME are removed from the framework and dispatcher-live; the base names and sessionCookieName() are exported from @cosmicdrift/kumiko-types/session-cookies and @cosmicdrift/kumiko-framework/api, getSessionCookies(c) returns the resolved names of a request. The testing package's CSRF_COOKIE_NAME stays and resolves to the unprefixed name (e2e servers run without Secure).
migration: Every user logs in once after the deploy, because the old kumiko_auth cookie is no longer read. Custom clients, proxies or scripts that read or forward the cookies by literal name break: read the names through sessionCookieName() / resolveSessionCookieNames() (types package) or getSessionCookies(c) on the server, and handle both the prefixed and the plain name in browser code (readCsrfToken() already does). Replace imports of AUTH_COOKIE_NAME, CSRF_COOKIE_NAME and TENANT_COOKIE_NAME with AUTH_COOKIE_BASE, CSRF_COOKIE_BASE and TENANT_COOKIE_BASE plus sessionCookieName(); e2e helpers that imported CSRF_COOKIE_NAME from @cosmicdrift/kumiko-dispatcher-live import it from @cosmicdrift/kumiko-testing/e2e instead (known: solon e2e/_helpers/api.ts and e2e/session-ended.spec.ts, kumiko-enterprise ai-agent-live-transcription.integration.test.ts uses AUTH_COOKIE_NAME). A reverse proxy that strips or rewrites cookie names must pass the __Host- names unchanged. Staging or preview deployments over plain http need no change (Secure is off there); set auth.secureCookies (also accepted by runProdApp) explicitly when TLS terminates before the app and NODE_ENV is not "production". A standalone createAuthRoutes mount outside buildServer must also mount sessionCookiesMiddleware with the same resolved names, otherwise the readers fall back to the domain-less default.
-->
