---
"@cosmicdrift/kumiko-bundled-features": patch
---

The `run-export-jobs` cron now reports a `export_cleanup_backlog_age` gauge after every storage-cleanup pass: seconds since the oldest done-status export bundle should have had its `downloadStorageKey` cleared (TTL+grace expired) but a `provider.delete` failure left it in place. 0 when the pass has no backlog. The metric is emitted from the same job that performs the cleanup, so a stalled cron makes the gauge go stale too, catchable with a plain `absent()` alert instead of a second liveness mechanism.

<!-- kumiko-changes
feature: user-data-rights
type: improvement
title: export-cleanup cron now emits an export_cleanup_backlog_age gauge to surface stalled runs
detail: storageCleanupPass deletes expired export bundles via provider.delete, but the storage provider only exposes list() (no timestamps), so a silent failure left unencrypted PII bundles sitting in the bucket with no signal. runExportJobs now accepts an optional MetricsHandle and, after the cleanup loop, reports the age in seconds of the oldest done-status job whose expiresAt+grace has passed while downloadStorageKey is still set (0 if none) via the new EXPORT_CLEANUP_BACKLOG_AGE_METRIC ("export_cleanup_backlog_age", a gauge — no _total/_seconds suffix per validateMetricName, unit: "seconds" carried in the r.metric() definition instead). feature.ts's job handler builds the handle itself with createMetricsHandle(ctx.meter, "user-data-rights") since JobContext has no bound ctx.metrics (that only exists on HandlerContext, built per write/query dispatch) — falls back to createNoopMetricsHandle() when ctx.meter is unset. Metric emission is wrapped in try/catch so an observability hiccup never fails an otherwise-successful cleanup pass. Scope is deliberately done-status only; failed-status cleanup candidates have no expiresAt/TTL.
-->
