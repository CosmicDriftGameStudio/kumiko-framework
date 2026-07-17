---
"@cosmicdrift/kumiko-framework": minor
---

Merge `r.configKey(name, def)` into `r.config()` as an overload instead of a
separate method: `r.config(name, def)` now returns the bare `ConfigKeyHandle<T>`
directly for the single-key case, while `r.config({keys:{...}})` keeps
returning a handle record for the multi-key case. Same qualification/storage
behavior either way — this only removes the second method name. `r.configKey`
is gone; call sites written against it (published for one release in 0.151.0)
switch to `r.config(name, def)`.
