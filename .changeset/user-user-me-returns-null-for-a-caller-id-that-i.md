---
"@cosmicdrift/kumiko-bundled-features": patch
---

user:me returns null for a caller id that is no uuid

An anonymous or system caller (id `anonymous`, `system`) reached `user:me` with an id that the uuid column rejects, so the query failed with a Postgres error and aborted the transaction. The handler now returns null for such callers without querying.

<!-- kumiko-changes
feature: user
type: fix
title: user:me returns null for a caller id that is no uuid
-->
