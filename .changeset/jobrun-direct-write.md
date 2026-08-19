---
"@cosmicdrift/kumiko-framework": patch
---

Job runs (`jobRun`) no longer go through the event store. Every job execution used to append a `run-started` + `run-completed`/`run-failed` event replayed through two inline projections — in the busiest apps this was ~99% of all events ever written, for data nothing else replays or subscribes to. `onJobStart`/`onJobComplete`/`onJobFailed` now write straight into the (renamed) `store_job_runs` / `store_job_run_logs` tables, with a new daily `jobs:job:retention-cleanup` job (`retentionDays`, default 30) purging old rows so the tables don't grow forever.

**Breaking for raw-SQL consumers:** the table is renamed `read_job_runs` → `store_job_runs` (`store_job_run_logs` is unchanged). The migration drops `read_job_runs` outright — old run history is not preserved, it was operational/debug data, not a system of record. Apps that only use the shipped `job-runs-screen`/`jobs:query:*` handlers are unaffected; apps with a raw SQL dependency on `read_job_runs` (e.g. `kumiko-studio`'s migrations/tests) need a follow-up on their side.

Also fixes two `user-data-rights` cron jobs (`run-export-jobs`, `run-forget-cleanup`) that were firing every minute instead of daily — the 6-field trigger string carried a leading seconds field that this repo's cron parser doesn't use, so `"0 * * * * *"` meant "every minute" instead of the intended midnight-3am daily run.
