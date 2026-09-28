---
"@cosmicdrift/kumiko-framework": minor
---

TestStack.drainJobs() waits deterministically for jobs and their follow-up consumers

<!-- kumiko-changes
feature: framework
type: improvement
title: TestStack.drainJobs() waits deterministically for jobs and their follow-up consumers
detail: |
  Migration note: replace `waitFor` polling on a job's side effect with `await
  stack.drainJobs()`; it rejects with the job's name and error on final
  failure. New `JobRunner.countPendingJobs()` — hand-written `JobRunner`
  stubs (test doubles) must add it.
-->
