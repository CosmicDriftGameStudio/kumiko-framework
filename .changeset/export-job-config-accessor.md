---
"@cosmicdrift/kumiko-bundled-features": patch
---

Fix: the data-export cron job (`run-export-jobs`) read `ctx.config` (a per-request ConfigAccessor that only the HTTP dispatcher builds), so in the cron-job context it was always undefined → `createFileProviderForTenant` threw "ctx.config is missing" and every export landed on `failed`. The r.job wrapper now builds the per-tenant ConfigAccessor from `ctx.configResolver` (which the job context does carry, like soft-delete-cleanup uses), mirroring the HTTP path's `_configAccessorFactory`. New integration test drives the real registered cron handler through its job context (red before, green after) — the existing test passed a manual provider and never exercised this path.
