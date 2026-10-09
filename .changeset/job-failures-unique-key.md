---
"@cosmicdrift/kumiko-bundled-features": patch
---

jobs: `store_tenant_job_failures` now holds at most one row per (tenant, job, subject). Parallel final failures serialize on an advisory lock and two partial unique indexes enforce the key; the migration removes existing duplicates first (run `kumiko-schema generate` in consuming apps).
