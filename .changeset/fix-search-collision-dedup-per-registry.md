---
"@cosmicdrift/kumiko-framework": patch
---

Search-index collision warnings now dedup per registry instead of in a
process-global Set. The previous module-global `warnedKeyCollisions` Set in
`buildSearchDocument` silenced the "searchPayloadExtension tried to overwrite …"
warning for every later app instance once any instance had hit a given
`entity:key` collision, and leaked dedup state across tests in the same
process. It is now scoped to the registry via a `WeakMap<Registry, Set>`, so
each app (and each test) dedups independently; the per-save dedup behaviour is
unchanged. The warning text also reads "base field" instead of the stray German
"Stammfield".
