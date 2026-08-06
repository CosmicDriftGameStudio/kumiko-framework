---
"@cosmicdrift/kumiko-framework": minor
---

Write handlers now get `ctx.dbOutsideTransaction`, a tenant-scoped handle on the unbound connection pool that isn't tied to the handler's own transaction. Writes made through it survive a rollback of the handler's tx — use it to record facts about side effects that already happened outside the database (e.g. a paid external call) before the handler throws.
