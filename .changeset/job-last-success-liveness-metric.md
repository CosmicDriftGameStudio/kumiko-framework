---
"@cosmicdrift/kumiko-framework": minor
---

Generic job-liveness metric `kumiko_job_last_success_timestamp_seconds{job}` (fw#3052).

The job-runner now stamps a standard gauge with the Unix timestamp of the last successful run of every job registered via `r.job`, so any consumer gets a real dead-man for all its crons with `time() - kumiko_job_last_success_timestamp_seconds{job="…"} > <interval + buffer>`. A failed run leaves the value untouched. The k8s CronJob alerts never covered these jobs — they run in-process in a long-lived pod and create no CronJob object. Note that the series is absent until the first success after a restart; `docs/reference/job-liveness-metric.md` explains the `for:` that implies for the alert side.

<!-- kumiko-changes
feature: framework
type: improvement
title: Generic job-liveness metric kumiko_job_last_success_timestamp_seconds{job} (fw#3052).
-->
