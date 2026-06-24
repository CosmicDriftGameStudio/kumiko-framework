# Sample: Session Revocation

**I want JWTs to be revocable server-side — logout, password change, or admin force-logout should invalidate outstanding tokens before they expire.**

## What this sample shows

The production wiring shape: an app builds `createSessionCallbacks()` against a live DB handle, then hands the creator, revoker, and checker to `buildServer({ auth: ... })`. From there the framework handles the rest — login persists a `sid`, the middleware checks it on every request, logout flips the DB row, and a forged JWT without a matching session is rejected.

## The wiring in 3 sentences

1. `createSessionCallbacks({ db })` returns `sessionCreator`, `sessionRevoker`, and `sessionChecker` backed by `read_user_sessions`.
2. `buildServer({ auth: { sessionCreator, sessionRevoker, sessionChecker, ... } })` links the JWT `jti` claim to that table on every request.
3. After logout (or mass-revoke on password change), the same JWT returns 401 even though the signature is still valid.

## What to copy into your app

```ts illustration
const db = createDbConnection(config.databaseUrl);
const callbacks = createSessionCallbacks({ db });

const server = buildServer({
  registry: buildRegistry([
    createSessionsFeature({
      autoRevokeOnPasswordChange: callbacks.sessionMassRevoker,
    }),
    // ... other features
  ]),
  context: { db, /* ... */ },
  jwtSecret: process.env.JWT_SECRET,
  auth: {
    membershipQuery: "tenant:query:memberships",
    loginHandler: "auth-email-password:write:login",
    sessionCreator: callbacks.sessionCreator,
    sessionRevoker: callbacks.sessionRevoker,
    sessionChecker: callbacks.sessionChecker,
  },
});
```

## Design rules

1. **Sessions are a feature, not built-in.** Without `createSessionsFeature()` and wired callbacks, the app issues plain stateless JWTs — valid until expiry, no revocation path.
2. **Storage is pluggable.** This sample uses the default DB-backed impl; swap in Redis or Memcached by implementing the same `SessionCreator` / `SessionRevoker` / `SessionChecker` signatures.
3. **`jti` is the link.** When a checker is wired, the middleware never trusts the JWT alone — it confirms the session row is still live.

## Tests

- **End-to-end:** login → authenticated query → logout → same token rejected with 401
- **Wiring contract:** copies the `buildServer({ auth: ... })` block from the sample comment verbatim
