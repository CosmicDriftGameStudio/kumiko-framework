---
"@cosmicdrift/kumiko-framework": minor
---

api: server-side Origin-allowlist guard for CSRF hardening (#340)

Adds `AuthRoutesConfig.allowedOrigins` — an opt-in server-side Origin check on
cookie-authenticated, state-changing `/api/*` requests, layered on top of the
double-submit CSRF token. Apps that widen the auth cookie across subdomains via
`auth.cookieDomain` should set it to the apex + admin host (never tenant
subdomains): a wide cookie otherwise lets an XSS on any subdomain read the
JS-readable csrf cookie and forge an authenticated request. Requests without an
Origin header fall back to `Sec-Fetch-Site` and then to the CSRF token, so the
guard is defense-in-depth rather than a replacement.

Potentially breaking for consumers that set `cookieDomain`: the framework now
**fails closed** — `buildServer` refuses to boot when `cookieDomain` is set but
`allowedOrigins` is empty, because a wide cookie without an Origin check leaves
the JS-readable csrf cookie exploitable from any subdomain. Set `allowedOrigins`
(apex + admin host) in the same deploy as the upgrade, or set
`unsafeSkipOriginCheck: true` to opt out explicitly for a single-host deployment.
