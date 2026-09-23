---
"@cosmicdrift/kumiko-bundled-features": minor
---

auth handlers switch from GUEST_USER (roles: ["all"]) to the anonymous identity with a per-IP rateLimit

<!-- kumiko-changes
feature: auth-email-password
type: breaking
title: auth handlers switch from GUEST_USER (roles: ["all"]) to the anonymous identity with a per-IP rateLimit
migration: |
  The auth-email-password and auth-mfa handlers reachable from unauthenticated /auth/* routes (login, invite-accept-with-login, invite-signup-complete, reset-password, signup-confirm, verify-email, confirm-account-unlock, signup-request, the token-request handlers, mfa verify, mfa enable-start-preauth, mfa enable-confirm-preauth) now declare access: { roles: ["anonymous"] } instead of access: { roles: ["all"] }, each with its own rateLimit: { per: "ip+handler", limit, windowSeconds }. Enforcing that rateLimit on a request that carries a client IP requires a RateLimitResolver (Redis), same as the already rate-limited self-registration-status query; without one these handlers fail with InternalError (fail-closed, #1467). The password-reset, email-verification and account-unlock request routes keep answering 200 for anti-enumeration, so there the failure shows up as a "[kumiko] token request handler ... failed" error log line and no mail is sent. Wire Redis (or context.rateLimit) before relying on these routes. Test fixtures that hand-roll a guest SessionUser with roles: ["all"] must switch to roles: ["anonymous"] (or createAnonymousUser from @cosmicdrift/kumiko-framework/engine).
-->
