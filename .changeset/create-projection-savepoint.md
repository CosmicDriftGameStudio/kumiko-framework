---
"@cosmicdrift/kumiko-framework": patch
---

Confine the entity executor's projection insert/update/delete in a savepoint, like the event append already is. A raw DB error out of the projection step otherwise poisons the enclosing transaction (Bun.SQL rejects the whole `begin()` once any statement in it fails, even when the JS layer caught the error), so a sibling write sharing that transaction — a handler that records an outcome after a failed nested write — surfaced as a 500 instead of the clean failure the executor had already produced.
