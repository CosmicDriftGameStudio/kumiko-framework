---
"@cosmicdrift/kumiko-bundled-features": patch
---

Parallel first writes of the same tenant- or system-level config key no longer create duplicate rows.

<!-- kumiko-changes
feature: config
type: improvement
title: config:write:set serialises concurrent writes of the same key
detail: The unique index on (key, tenantId, userId) does not cover a NULL userId, so two parallel first `config:write:set` calls for a tenant- or system-level key each created a row. The handler now takes a transaction-scoped advisory lock per (key, tenantId, userId) before looking up the existing row.
-->
