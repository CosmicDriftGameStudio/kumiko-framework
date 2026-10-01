---
"@cosmicdrift/kumiko-bundled-features": minor
---

store_job_runs gets an index on started_at (fw#3396)

Windowed dashboard aggregates over job runs (metrics feature) filter on started_at; the index keeps them off a sequential scan.

<!-- kumiko-changes
feature: jobs
type: improvement
title: store_job_runs gets an index on started_at (fw#3396)
migration: |
  Run `kumiko migrate generate` and apply the migration: it adds `store_job_runs_started_at_idx`.
-->
