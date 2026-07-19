---
"@cosmicdrift/kumiko-bundled-features": patch
---

Fix `tenant:query:members` / `tenant:query:invitations` decrypting PII fields concurrently via `Promise.all`, which fired 2 `decryptStoredPii` calls per row against `PgKmsAdapter`'s own small dedicated connection pool (default `max: 4`). Tenants with more than a couple members/invitations exhausted that pool, surfacing as `"the connection was closed"` (#1257). Both handlers now decrypt sequentially; `members.query.ts` additionally dedupes by user instead of by membership row.
