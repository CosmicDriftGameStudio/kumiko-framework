---
"@cosmicdrift/kumiko-framework": minor
---

Auth routes no longer boot in production with the in-memory login rate limiter.

<!-- kumiko-changes
feature: framework
type: breaking
title: Production boot requires real login and MFA rate limiters
detail: When `loginRateLimit` or an MFA rate limit (`mfaVerifyRateLimit`, `mfaPreauthEnableStartRateLimit`, `mfaPreauthConfirmRateLimit`) is left unset, the auth routes fell back to an in-memory limiter, and with NODE_ENV=production they only logged a warning. That limiter counts per replica and drops its oldest buckets after 10,000 keys, so an attacker could reset a target's counter. With NODE_ENV=production the fallback now throws at boot. `runProdApp` already wires Redis-backed limiters and is unaffected. Development and tests keep the in-memory default.
migration: A custom `buildServer` or `createAuthRoutes` setup in production passes `createRedisLoginRateLimiter(redis, ...)` for each of these options, or `null` to switch one off explicitly.
-->
