---
"@cosmicdrift/kumiko-bundled-features": patch
---

`tenant:query:member-directory` and `tenant:query:tenant-directory` now sort their rows (tenants by name then id, members by id), so a `limit` always keeps the same rows instead of whichever the database returned first.

<!-- kumiko-changes
feature: tenant
type: fix
title: Member and tenant directory lookups return a stable order under a limit
-->
