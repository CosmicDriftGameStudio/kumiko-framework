---
"@cosmicdrift/kumiko-framework": patch
---

The event-store executor's `create()` and `restore()` now run their validation (global-tenancy guard, `soft_delete_not_enabled`) before resolving the connection, so callers get the proper 4xx error instead of an internal "no connection bound" error. List `totalCount` always counts over the full WHERE, and a PII backfill failure for an unresolvable catalog event subject no longer suggests the entity-only retry options. The shadow-swap RLS and blind-index error messages now state the concrete action (full KMS wiring for the blind-index key).

<!-- kumiko-changes
feature: framework
type: fix
title: Executor create/restore validate before connection binding; clearer rebuild and backfill errors
-->
