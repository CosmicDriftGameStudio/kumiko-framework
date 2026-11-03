---
"@cosmicdrift/kumiko-framework": patch
---

Integration test for dropping the system read policy when a table loses systemRowsReadable.

<!-- kumiko-changes
feature: framework
type: fix
title: upgrade path test for the stale kumiko_system_tenant_read policy
detail: A new integration test applies a table marked `systemRowsReadable`, regenerates the schema without the marker, and checks that the migration drops `kumiko_system_tenant_read` and that `schema apply` removes the policy from `pg_policies` while the isolation policy stays.
-->
