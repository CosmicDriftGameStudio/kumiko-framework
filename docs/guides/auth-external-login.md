---
status: reference
verified: 2026-10-26
evidence: "packages/bundled-features/src/auth-email-password/web/return-path.ts, static-login.ts (#3987, static-login subpath); kumiko-framework#3500 (configurable login and post-logout targets); #3573 (loginUrl function, validated next); packages/bundled-features/src/auth-email-password/web/auth-gate.tsx; auth-redirect.ts; packages/framework/src/api/auth-routes.ts (retiredCookieDomains)"
---

# Login on another page: `loginUrl`, `postLogoutUrl`, `retiredCookieDomains`

By default the SPA shows the built-in login screen. When the login page lives elsewhere (a marketing site on the apex domain, a separate host), the auth gate sends visitors there and brings them back.

## Gate options

`makeAuthGate(opts)` and `makeSessionAuthGate(opts)` from `@cosmicdrift/kumiko-bundled-features/auth-email-password/web` accept:

- `loginUrl`: a root-relative path or an http(s) URL, or a function `(locale, returnPath) => string`. An unauthenticated visitor is redirected there.
- `postLogoutUrl` (session gate only): where logout navigates to. Without it, logout reloads the page.

With a string, the gate appends `next=<current path + query + hash>` itself. With a function, the gate passes the UI locale and the return path and uses the result as is, so the function decides whether and how to carry `next` (use `NEXT_QUERY_PARAM`). That is how a per-locale login URL is built.

```ts illustration
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

## Back to the same page after reset or signup: `returnTo`

A visitor who lands on the login page with `next=/billing` and then needs a password reset or a new account should still end up on `/billing`. The login screen passes its `next` on as `returnTo` to the "Forgot password" and "Sign up" links. The reset and signup requests send it to the server, which appends it to the link in the mail. The reset page and the signup completion page read it back and continue there.

```ts illustration
// custom signup page: the activation mail leads back to the invoice the visitor opened
<SignupScreen returnTo="/invoices/2026-0142" />

// custom reset page: read the value the mail link carried
const returnTo = readReturnToFromSearch(window.location.search); // "/billing" or null
```

Allowed targets are root-relative paths on the same origin, at most 2048 characters. `isSafeReturnPath` rejects:

- anything that does not start with a single `/`, so `//evil.example` and `https://evil.example` are out
- a backslash, whitespace or control characters, which some browsers turn into `/`
- dot segments such as `/./` or `/%2e%2e/`, because URL normalization would turn `/.//evil` into `//evil`

The server applies the same check before it writes the mail link. An invalid value is dropped without an error, so a crafted `returnTo` never voids the reset or signup itself; the visitor just lands on the default page. `isSafeNextPath` for `next` uses the same rules. Both helpers and `RETURN_TO_QUERY_PARAM` come from `@cosmicdrift/kumiko-bundled-features/auth-email-password/web`.

## Login form on a static marketing site

A marketing site built with plain Astro scripts can host the login form itself. `@cosmicdrift/kumiko-bundled-features/auth-email-password/static-login` imports neither React nor the renderer and touches no `window` at import time:

```ts illustration
import {
  loginWithPassword,
  postLoginPath,
  verifyMfaCode,
} from "@cosmicdrift/kumiko-bundled-features/auth-email-password/static-login";

const isAppPath = (path: string) => path.startsWith("/app");

const result = await loginWithPassword(email, password);
if (result.kind === "mfa-challenge") showCodeField(result.challengeToken); // then verifyMfaCode(token, code)
if (result.kind === "success") {
  location.assign(postLoginPath({ search: location.search, landingPath: result.landingPath, isAppPath, fallbackPath: "/app" }));
}
if (result.kind === "failure") showError(result.reason, result.retryAfterSeconds);
```

The result is one union: `success`, `mfa-challenge`, `mfa-setup-required` and `failure`. A failure carries `login_failed`, `mfa_verify_failed`, `rate_limited` (with `retryAfterSeconds`) or `network`. `postLoginPath` follows `next` only when it passes `isSafeReturnPath` and `isAppPath`; otherwise it takes the landing path of the user, then the fallback. `forgotPasswordHref(path, search, isAppPath)` carries the same `next` into the reset link as `returnTo`.

On the app side, `marketingLoginUrl` builds the `loginUrl` function for the auth gate. It picks the login path by locale, adds the visitor's place as `next` when it is an app path, and never redirects from a login page back to itself:

```ts illustration
import { marketingLoginUrl } from "@cosmicdrift/kumiko-bundled-features/auth-email-password/static-login";

const AuthGate = makeSessionAuthGate({
  loginUrl: marketingLoginUrl({
    localePaths: { default: "/en/login", byLocale: { de: "/de/anmelden" } },
    isAppPath: (path) => path.startsWith("/app"),
  }),
});
```
