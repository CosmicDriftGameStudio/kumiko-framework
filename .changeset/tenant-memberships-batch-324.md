---
"@cosmicdrift/kumiko-bundled-features": patch
---

tenant: batch-load tenants in the `memberships` query (#324)

The `memberships` query enriched each membership with its tenant name/key via
one `fetchOne` per row — an accepted N+1, run on every login and switch-tenant.
The query-builder already supports `where: { id: [...] }` → `IN (...)`, so it now
loads all referenced tenants in a single batch and maps each membership from a
lookup table. Behaviour is unchanged: disabled tenants are still filtered, and a
membership whose tenant projection row is missing (drift) is still kept without
name/key (no login lockout).
