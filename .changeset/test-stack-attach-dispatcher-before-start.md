---
"@cosmicdrift/kumiko-testing": patch
---

setupTestStack attaches the job dispatcher before it starts the job runner, as the prod entrypoints do. A runOnBoot job that calls `ctx.dispatch.write` no longer fails with "called before dispatcher attached" when the worker picks it up during setup.

<!-- kumiko-changes
feature: testing
type: fix
title: Test stack attaches the job dispatcher before the runner starts
detail: With jobs.consumerLane set, setupTestStack started the runner (worker plus runOnBoot enqueue) before attachDispatcher. Under load a boot job such as a perTenant sync reached ctx.dispatch.write in that window, failed, and drainJobs reported it later as a job failure in an unrelated test. The order now matches the prod entrypoint.
-->
