---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

`authMiddleware` used to set `user.roles` straight from the JWT's `roles` claim once `sessionChecker` confirmed the session was still live — a role change made after login (promote to admin, revoke a tenant role) had no effect until the token expired. `sessionChecker` (`createSessionCallbacks`) now re-derives roles from the DB on every authenticated request, composing global (`userTable.roles`) and tenant-scoped (`tenantMembershipsTable.roles`) roles via the same `buildSessionRoles` primitive login already uses, so a DB-side role change now takes effect on the very next request made with the same still-live token — no re-login, no waiting for JWT expiry.

`sessionChecker`'s return type widens from `AuthSessionStatus` to a backward-compatible `AuthSessionCheckResult` union: the existing bare status strings (`"live" | "missing" | "revoked" | "expired" | "blocked"`) still cover every non-live outcome, and a live session now returns `{ status: "live", roles }` when roles could be derived. A DB throw on either lookup, or a user row that legitimately doesn't exist (e.g. a bootstrap actor with no persisted `userTable` row), fails open to the bare `"live"` string, and the middleware falls back to the JWT's frozen `roles` claim in that case — the same fail-open posture the session-liveness check already had. A missing tenant-membership row is not a fail-open case: it means the user genuinely has no tenant-scoped roles.

Because roles can now change mid-session, the default session-backed JWT TTL (used when `sessionChecker` is wired and no explicit `jwtTtl` is set) drops from 24h to 8h — the token itself carries less trust now that the DB is re-checked on every request, so a shorter window bounds how long a *fully offline* verifier (no `sessionChecker` wired, if one ever bypasses it) would honor a stale roles claim. The stateless 1h default (no `sessionChecker`) is unchanged.
