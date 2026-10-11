---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-dispatcher-live": minor
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-dev-server": minor
"@cosmicdrift/kumiko-testing": minor
"@cosmicdrift/kumiko-server-runtime": minor
---

Session cookies written Secure and without a Domain attribute now use the `__Host-` prefix: `__Host-kumiko_auth`, `__Host-kumiko_csrf` and `__Host-kumiko_tenant`. A browser only accepts such a cookie when it is Secure, Path=/ and host-only, so a sibling subdomain can no longer set or shadow it. With `auth.cookieDomain` or without Secure the plain names stay. The new auth option `secureCookies` forces the Secure flag (default: `NODE_ENV === "production"`); buildServer resolves it once.

The base names and the naming rule live in `@cosmicdrift/kumiko-types/session-cookies` (`AUTH_COOKIE_BASE`, `CSRF_COOKIE_BASE`, `TENANT_COOKIE_BASE`, `sessionCookieName`, `resolveSessionCookieNames`). `readCsrfToken()` reads the prefixed csrf cookie first and falls back to the plain one.

A request that carries the auth or the csrf cookie name twice is treated as having no session cookie (anonymous with `anonymousAccess`, otherwise 401) and the response expires every cookie variant, so a shadowed or stale duplicate can no longer pin a browser to the wrong session.

The Origin guard now also runs without `allowedOrigins` when the app's public origin is known: the new auth option `publicOrigin`, which runProdApp fills from `auth.mail.baseUrl` and then from the `APP_BASE_URL` env. It admits that origin plus the request's own host. Without such a URL runProdApp warns at boot in production and keeps running.

<!-- kumiko-changes
feature: framework
type: breaking
title: Secure host-only session cookies use the __Host- prefix
detail: Auth, csrf and tenant cookies are named __Host-kumiko_auth, __Host-kumiko_csrf and __Host-kumiko_tenant when they are written Secure and without a Domain (the tenant cookie is always host-only). With auth.cookieDomain or without Secure the auth and csrf names stay kumiko_auth and kumiko_csrf. New auth option secureCookies forces Secure (default NODE_ENV === "production"). Login deletes the legacy unprefixed host-only cookies, logout and deleteTenantCookie delete the prefixed and the legacy names. The server reads only the resolved names, so a request that carries only the legacy kumiko_auth is anonymous. AUTH_COOKIE_NAME, CSRF_COOKIE_NAME and TENANT_COOKIE_NAME are removed from the framework and dispatcher-live; the base names and sessionCookieName() are exported from @cosmicdrift/kumiko-types/session-cookies and @cosmicdrift/kumiko-framework/api, getSessionCookies(c) returns the resolved names of a request. The testing package's CSRF_COOKIE_NAME stays and resolves to the unprefixed name (e2e servers run without Secure).
migration: Every user logs in once after the deploy, because the old kumiko_auth cookie is no longer read. Custom clients, proxies or scripts that read or forward the cookies by literal name break: read the names through sessionCookieName() / resolveSessionCookieNames() (types package) or getSessionCookies(c) on the server, and handle both the prefixed and the plain name in browser code (readCsrfToken() already does). Replace imports of AUTH_COOKIE_NAME, CSRF_COOKIE_NAME and TENANT_COOKIE_NAME with AUTH_COOKIE_BASE, CSRF_COOKIE_BASE and TENANT_COOKIE_BASE plus sessionCookieName(); e2e helpers that imported CSRF_COOKIE_NAME from @cosmicdrift/kumiko-dispatcher-live import it from @cosmicdrift/kumiko-testing/e2e instead (known: solon e2e/_helpers/api.ts and e2e/session-ended.spec.ts, kumiko-enterprise ai-agent-live-transcription.integration.test.ts uses AUTH_COOKIE_NAME). A reverse proxy that strips or rewrites cookie names must pass the __Host- names unchanged. Staging or preview deployments over plain http need no change (Secure is off there); set auth.secureCookies (also accepted by runProdApp) explicitly when TLS terminates before the app and NODE_ENV is not "production". A standalone createAuthRoutes mount outside buildServer must also mount sessionCookiesMiddleware with the same resolved names, otherwise the readers fall back to the domain-less default.
-->

<!-- kumiko-changes
feature: framework
type: improvement
title: Duplicate session cookie names end the cookie session
detail: When the Cookie header carries the resolved auth or csrf cookie name more than once, authMiddleware ignores the cookie transport and expires every variant (prefixed host-only, legacy host-only, the cookieDomain variant and retired domains). With anonymousAccess the request continues as anonymous, otherwise it gets 401 missing_token; a Bearer token on the same request still authenticates. A prefixed and a legacy name side by side are not a duplicate. The cookie clearing moved from the auth routes into clearSessionCookies in session-cookies.ts; ResolvedSessionCookies carries domain and retiredDomains.
-->

<!-- kumiko-changes
feature: framework
type: breaking
title: Origin guard defaults on when the public app URL is known
detail: New auth option publicOrigin. Without allowedOrigins, cookieDomain and unsafeSkipOriginCheck, buildServer mounts the Origin guard for cookie-authenticated state-changing /api requests and admits publicOrigin plus the request's own host (Host header). runProdApp sets publicOrigin from auth.publicOrigin, then auth.mail.baseUrl, then the APP_BASE_URL env (origin only, path dropped); with none of them in production it logs a warning that the Origin guard is off and boots anyway. allowedOrigins keeps its strict meaning, and the WebSocket check and the anonymous downgrade still use only allowedOrigins.
migration: Cookie-authenticated POST, PUT, PATCH or DELETE requests from a page on another origin than the public app URL and than the API host itself now get 403 origin_not_allowed in runProdApp deployments that set auth.mail.baseUrl or APP_BASE_URL. A web client served from a different host than the API (for example a sibling subdomain) must list its origin in auth.allowedOrigins. Same-host setups, custom domains served by the same server and Bearer clients need no change.
-->
