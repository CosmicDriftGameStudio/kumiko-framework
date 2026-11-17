# Sample: Session Exchange

**I want my own login method (Apple/Google ID token, email code) without rebuilding cookies, JWTs and rate limits.**

## What this sample shows

An anonymous write handler verifies an identity and returns `{ kind: "auth-session", session }`. The app lists it under `auth.sessionExchangeHandlers`; `POST /api/auth/session-exchange` runs it and mints the session like `/auth/login` (token, cookies). The rate limit counts per IP and method and is not reset on success, because the route cannot tell whose code was right. By default it reuses the login limiter; set `auth.sessionExchangeRateLimit` to a larger limiter, or `null` to turn it off (for example when the methods carry signed tokens).

## What to copy into your app

```ts illustration
auth: {
  membershipQuery: "tenant:query:memberships",
  loginHandler: "auth-email-password:write:login",
  sessionExchangeHandlers: { code: "demo-exchange:write:code" },
},
```

The client calls `POST /api/auth/session-exchange` with `{ method: "code", payload: { ... } }`.

## Design rules

1. **Only listed handlers can issue a session.** The route resolves `method` against the map (own keys only); the handler QN never comes from the client.
2. **The handler owns verification.** The demo compares a fixed code; a real handler verifies the ID token signature and audience first, then calls `sessionForVerifiedUser(ctx, { email })` (or `{ userId }`) for the login gates: account status, membership choice, claims. A lookup by email only issues a session for a verified address (otherwise a pre-registered attacker account would be taken over by the victim), a lookup by `userId` trusts your own identity link. There is no password or lockout gate. There is no MFA gate: boot aborts when `auth-mfa` is mounted together with `sessionExchangeHandlers`.
3. **Anything but `auth-session` is rejected.** An MFA challenge or foreign result yields 500 and no cookie.
4. **Errors map like login.** `details.reason` goes through `loginErrorStatusMap`.
5. **Grant SYSTEM to the one handler, hide it from agents.** `escapeHatch: { grants: ["systemIdentity"] }` on the exchange handler, not `r.systemScope()` on the feature, and `agent: { expose: false }` because the payload is a credential.

## Tests

- **End-to-end over HTTP:** exchange returns a token that authenticates a query
- **Wrong code:** 401 via `invalid_credentials`
- **Restricted user:** no session
- **Unknown method:** 400
