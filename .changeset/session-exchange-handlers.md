---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-server-runtime": patch
"@cosmicdrift/kumiko-dev-server": patch
---

Apps can register their own login methods that the framework turns into a session.

<!-- kumiko-changes
feature: framework
type: improvement
title: custom login methods via session-exchange handlers
detail: `auth.sessionExchangeHandlers` maps a method name to an anonymous write handler that verifies the identity itself (for example an Apple or Google ID token) and returns `{ kind: "auth-session", session }`. The new public route `POST /auth/session-exchange` runs the handler and mints the session like `/auth/login`, including cookies. The login rate limiter counts per IP and method and is not reset on success. Only listed handlers can issue a session. The route's rate limit (IP + method, no reset) reuses the login limiter unless `auth.sessionExchangeRateLimit` sets another one or `null`. The new `sessionForVerifiedUser` helper from auth-email-password runs the login gates (account status, membership choice, claims) after the identity proof, with a verified-email requirement for email lookups, without password or lockout gates. Boot aborts when `auth-mfa` is mounted together with `sessionExchangeHandlers`, since the exchange cannot enforce a second factor yet.
-->
