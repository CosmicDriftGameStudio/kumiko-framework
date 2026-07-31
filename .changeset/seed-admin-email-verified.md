---
"@cosmicdrift/kumiko-bundled-features": patch
---

`seedAdmin` now accepts an optional `emailVerified` flag and passes it through to `seedUserWithPassword` (default stays `false`, unverified). Without it, a dev-admin seeded via `seedAdmin()` was unverified and login failed with 422 `email_not_verified` — two apps (money-horse, solon) had already written their own backfill to work around it.
