---
"@cosmicdrift/kumiko-framework": patch
---

The parent-ref gate for global hosts is narrower and bounded.

<!-- kumiko-changes
feature: framework
type: fix
title: Global host gate skips readable hosts and where-rules and caps unpinned lists
detail: Hosts classified `systemRowsReadable` (including reference data) keep their tenant-scope `EXISTS` instead of being resolved up front. A global host whose `access.read` is a `where` rule opens no arm in the system-scope host check, because no row level security acts there. An unpinned list skips soft-deleted join rows and resolves at most 5000 host ids; beyond that the global host arm is left out and a warning is logged.
-->
