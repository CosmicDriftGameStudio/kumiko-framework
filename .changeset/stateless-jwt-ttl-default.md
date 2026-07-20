---
"@cosmicdrift/kumiko-framework": minor
---

`ServerOptions.jwtTtl` (`@cosmicdrift/kumiko-framework/api`) — configurable JWT lifetime in seconds, passed through to `createJwtHelper`'s new third param. `JwtHelper.ttlSeconds` exposes the resolved value; `createAuthRoutes` now derives the auth-cookie's `maxAge` from it instead of a separately hardcoded constant, so the two can never drift apart.

**Behavior change:** when `jwtTtl` is omitted, the default now depends on whether `auth.sessionChecker` is wired. With a session checker (revocation possible) it stays at the previous 24h default. Without one (stateless JWTs, no revocation) it drops to 1h — a leaked stateless token now has a much smaller exposure window. Set `jwtTtl` explicitly to opt out of the new stateless default.
