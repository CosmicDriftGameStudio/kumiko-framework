---
"@cosmicdrift/kumiko-framework": major
"@cosmicdrift/kumiko-bundled-features": major
---

Security hardening (audit "Welle 2"): closes a request-supplied-JSON-can-forge-raw-SQL path, a stale/blocked-principal token bypass, a cross-tenant idempotency-cache collision, a cross-tenant `tenant:update` hole, and adds session revocation on tenant-membership role change/removal. Two of these are breaking API changes:

- **`SqlExpression` is now branded.** Only `sql\`...\`` and `sql.raw(...)` produce a value the query layer recognizes as raw SQL. If your app or schema file builds a `SqlExpression` via an object literal (e.g. `{ kind: "sql-expr", sql: ..., params: ... }`) instead of those two helpers, that literal is no longer treated as raw SQL — it now gets bound as an ordinary JSON parameter, which will surface as a broken query (not a silent vulnerability) at the call site. Migration: replace the object literal with `sql\`...\`` or `sql.raw(...)`.
- **`IdempotencyGuard.check`/`.store` signature changed** from `(requestId)` to `(tenantId, userId, requestId)`, so the idempotency cache can no longer be hit across tenants/users by an attacker who guesses or replays a `requestId`. Any custom `IdempotencyGuard` implementation, or code calling `.check`/`.store` directly (outside the dispatcher's own `runBatch`, which already updated), needs the new signature. The Redis key format also changed (`${prefix}${requestId}` → `${prefix}${tenantId}:${userId}:${requestId}`) with no compatibility shim — on deploy, in-flight idempotent retries older than the request's own retry window may execute a second time (same as a first-ever request; not a correctness issue, just not a cache hit).

The remaining fixes (PAT/invite-login gates, `tenant:write:update` cross-tenant self-check, session revocation on role change/removal) are behavior-only and need no consumer code changes.
