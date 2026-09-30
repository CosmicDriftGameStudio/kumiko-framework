---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-dev-server": minor
---

setupTestStack can wire job run-logger callbacks, and setupTestStackFromFeatures does so by default

`TestStackOptions.jobs.runLogger` receives `{ registry, db }` and returns `onJobStart`/`onJobComplete`/`onJobFailed`. The stack awaits them before drainJobs() observes the outcome, so a log row is always written before drainJobs() resolves or rejects. `setupTestStackFromFeatures` (and with it `setupAppTestStack`) defaults to the same `jobRunLoggerCallbacks` prod uses whenever `jobs` is set and the jobs feature is mounted, so `tenantVisibleFailure` rows and `jobs:query:failures` work in tests without a hand-built harness.

<!-- kumiko-changes
feature: framework
type: improvement
title: setupTestStack can wire job run-logger callbacks, and setupTestStackFromFeatures does so by default
-->
