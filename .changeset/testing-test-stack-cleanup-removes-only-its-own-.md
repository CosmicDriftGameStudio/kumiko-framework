---
"@cosmicdrift/kumiko-testing": minor
"@cosmicdrift/kumiko-framework": minor
---

Test-stack cleanup removes only its own queues, and one sweep per integration run removes what finished or aborted runs left in Redis and Postgres.

<!-- kumiko-changes
feature: testing
type: breaking
title: Test-stack cleanup removes only its own queues; one sweep per integration run
detail: `stack.cleanup()` scanned the whole Redis for its namespace and queue keys, so every teardown got slower as the local Redis filled up. It now obliterates the stack's two job queues by name (new `obliterateJobQueues` in `@cosmicdrift/kumiko-framework/jobs`) and leaves the namespace to the run sweep. The integration runner gives every run an id, keeps it alive in Redis, puts it into Redis prefixes and database names, and after the run removes its own keys and databases plus those of runs whose alive key has expired. Databases still in use and keys of live runs (including a single `bun test` outside the runner) are kept.
migration: |
  Rename imports of `runWithTestDbTemplates` from `@cosmicdrift/kumiko-testing/integration-runner` to `runWithTestRun`. A test that builds its own JobRunner (`jobs.queueNamePrefix` on setupTestStack, `createJobRunner`) should take its prefix from `testRunQueueNamePrefix("<label>")` in `@cosmicdrift/kumiko-testing/stack`; the run sweep then removes its BullMQ keys, which a hand-made prefix such as `my-test-${Date.now()}` leaves behind. `stack.cleanup()` no longer flushes the Redis namespace; call `flushNamespace()` between tests where a test needs an empty namespace.
-->
