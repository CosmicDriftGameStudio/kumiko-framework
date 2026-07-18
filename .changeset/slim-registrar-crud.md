---
"@cosmicdrift/kumiko-framework": minor
---

Remove `r.crud()` registrar sugar. It only ever wrapped `registerEntityCrud()`
with no production call sites — call `registerEntityCrud(r, name, definition, options)`
directly instead.
