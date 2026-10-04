---
status: reference
verified: 2026-10-04
evidence: "kumiko-framework#3500 (configurable login and post-logout targets); #3573 (loginUrl function, validated next); packages/bundled-features/src/auth-email-password/web/auth-gate.tsx; auth-redirect.ts; packages/framework/src/api/auth-routes.ts (retiredCookieDomains)"
---

# Login on another page: `loginUrl`, `postLogoutUrl`, `retiredCookieDomains`

By default the SPA shows the built-in login screen. When the login page lives elsewhere (a marketing site on the apex domain, a separate host), the auth gate sends visitors there and brings them back.

## Gate options

`makeAuthGate(opts)` and `makeSessionAuthGate(opts)` from `@cosmicdrift/kumiko-bundled-features/auth-email-password/web` accept:

- `loginUrl`: a root-relative path or an http(s) URL, or a function `(locale, returnPath) => string`. An unauthenticated visitor is redirected there.
- `postLogoutUrl` (session gate only): where logout navigates to. Without it, logout reloads the page.

With a string, the gate appends `next=<current path + query + hash>` itself. With a function, the gate passes the UI locale and the return path and uses the result as is, so the function decides whether and how to carry `next` (use `NEXT_QUERY_PARAM`). That is how a per-locale login URL is built.

```ts
const AuthGate = makeSessionAuthGate({
  loginUrl: (locale, returnPath) =>
    `https://example.eu/${locale}/login?${NEXT_QUERY_PARAM}=${encodeURIComponent(returnPath)}`,
  postLogoutUrl: "https://example.eu/",
});
```

If the login URL points at the page the gate is mounted on, the gate renders the built-in login screen instead of redirecting, so it cannot loop.

## Validation

Both options are checked when the gate is created (a string) or when it is used (the function result). A value that is neither a safe root-relative path nor an http(s) URL, such as `javascript:`, throws with the option name instead of becoming a navigation target.

`next` comes back through the query string, so it is untrusted. `isSafeNextPath` accepts only same-origin root-relative paths: no `//host`, no backslash, no scheme, no whitespace or control characters. `readNextFromSearch(search)` returns the validated value or `null`. After a successful login (including the MFA steps) the built-in login route follows `next`. It re-validates the value and does not follow one that points at the login page itself. `buildLoginRedirectUrl` and `NEXT_QUERY_PARAM` are exported for a custom login page.

## `retiredCookieDomains`

When `cookieDomain` of `createAuthRoutes` changes, browsers keep the old and the new cookie as separate entries, and a stale `Domain=<old>` cookie can shadow the new one. List the former domains in `retiredCookieDomains` (also an option of `runDevApp` and the prod auth options). Login and logout then also send delete headers for them. Remove an entry once the session TTL has passed since the switch.

- An entry must not equal `cookieDomain`, be empty, or contain `;`, a comma or whitespace; `createAuthRoutes` throws otherwise.
- Browsers ignore a delete for a domain the responding host is not part of, so an entry only works when login or logout is served from that domain or a subdomain.
