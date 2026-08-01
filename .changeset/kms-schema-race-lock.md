---
"@cosmicdrift/kumiko-framework": patch
---

Fix `PgKmsAdapter` cold-start crash when two processes (e.g. API + worker) boot simultaneously against a fresh subject-keys database. `createSchema` now serializes its DDL with a `pg_advisory_xact_lock`, so the second process waits instead of colliding on the implicit `pg_type` row and crashing with a `23505` unique violation.
