---
"@cosmicdrift/kumiko-bundled-features": minor
---

jobs: store_tenant_job_failures holds at most one row per (tenant, job, subject)

<!-- kumiko-changes
feature: jobs
type: breaking
title: jobs: store_tenant_job_failures holds at most one row per (tenant, job, subject)
migration: |
  store_tenant_job_failures now enforces one row per (tenant_id, job_name, subject) through two partial unique indexes; parallel final failures serialize on an advisory lock. kumiko schema generate does NOT produce the dedup, and the unique index would fail on existing duplicates, so hand-edit the generated migration to contain exactly: DELETE FROM "store_tenant_job_failures" a USING "store_tenant_job_failures" b WHERE a."tenant_id" = b."tenant_id" AND a."job_name" = b."job_name" AND a."subject" IS NOT DISTINCT FROM b."subject" AND (a."failed_at", a."id") < (b."failed_at", b."id"); CREATE UNIQUE INDEX IF NOT EXISTS "store_tenant_job_failures_tenant_job_subject_uidx" ON "store_tenant_job_failures" ("tenant_id", "job_name", "subject") WHERE subject IS NOT NULL; CREATE UNIQUE INDEX IF NOT EXISTS "store_tenant_job_failures_tenant_job_null_subject_uidx" ON "store_tenant_job_failures" ("tenant_id", "job_name") WHERE subject IS NULL; DROP INDEX IF EXISTS "store_tenant_job_failures_tenant_job_subject_idx"; The DELETE keeps the newest row per key (by failed_at, then id).
-->
