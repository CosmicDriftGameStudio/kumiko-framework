---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
---

Add the metrics bundled feature and TenantDb.aggregate

New `metrics` and `metrics-system` features turn declarative `defineMetric` definitions into dashboard queries (eight defaults for jobs, delivery, sessions, tenants and audit). They are built on the new `TenantDb.aggregate` / `aggregateWhere` (grouped count, countDistinct, sum, avg with time buckets). `store_job_runs`, `store_delivery_attempts` and `store_user_sessions` get indexes for the windowed reads; run `kumiko migrate generate` after upgrading.

<!-- kumiko-changes
feature: metrics
type: improvement
title: Add metrics feature: declarative dashboard metrics over TenantDb.aggregate (fw#3396)
-->
