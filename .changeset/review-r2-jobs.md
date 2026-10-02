---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

Job runner hardening. A job run now stamps its event `metadata.feature` with the feature's raw name, the same value write-handlers stamp (previously the kebab-case form for camelCase features). On a runner built without a db, touching `ctx.db` in a job throws a named error instead of a `TypeError`. A non-primitive `tenantVisibleFailure.subjectFields` value now fails the run visibly (run row, `onJobFailed`) and is not retried. A failing last-success metric no longer fails a successful run, and the runner registers the standard metrics on its meter itself. A sequential job whose retry attempt hits a held lock keeps its remaining retry budget instead of getting a fresh one. `stop()` waits at most 1 second for queue readiness. A custom `tenant:query:active-tenant-ids` handler returning anything but `string[]` is rejected. `Registry` gains `getJobFeature`.

In the jobs feature, a failing tenant-failure record write no longer blocks the run-row update or fails a completed run, `jobs:query:list` honours multi-value status filters and rejects filters on unknown fields, and `jobs:write:retry` answers 422 for a payload that is still ciphertext because no KMS is configured.

<!-- kumiko-changes
feature: jobs
type: breaking
title: Job runner keeps retry budget on sequential lock conflicts, names the error without a db, fails loudly on bad tenantVisibleFailure subjects, stamps the raw feature name; jobs list filters multi-status
migration: |
  Events written by a job of a camelCase feature now carry metadata.feature with the raw feature name (for example "pubSubOrders") instead of the kebab-case form; update any audit or metrics filter that matched the kebab-case value. Custom Registry implementations must add getJobFeature(qualifiedJobName). A jobs:query:list call with filters on a field other than status is now rejected.
-->
