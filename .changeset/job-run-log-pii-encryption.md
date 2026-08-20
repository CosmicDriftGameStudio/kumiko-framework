---
"@cosmicdrift/kumiko-bundled-features": patch
---

Job-run log messages (`store_job_run_logs.message`) are now encrypted under the triggering user's DEK, same as `store_job_runs.payload` already was — closes the gap where free-text log lines from `onJobComplete`/`onJobFailed` landed in the unmanaged direct-write table without any PII protection. System/cron runs (no `triggeredById`) and rollout mode (no KMS configured) both stay plaintext, matching the existing payload behavior. `jobs:query:details` decrypts log messages for display.
