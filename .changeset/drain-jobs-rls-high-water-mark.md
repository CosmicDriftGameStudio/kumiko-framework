---
"@cosmicdrift/kumiko-testing": patch
---

testing: `stack.drainJobs()` reads the event high-water mark across tenants, so under row-level security it no longer returns while a shared consumer still has a backlog.

<!-- kumiko-changes
feature: testing
type: fix
title: drainJobs waits for consumer backlogs under row-level security
detail: `stack.drainJobs()` compared every shared consumer's cursor with the event high-water mark, but read that mark through the tenant-enforced pool. With `rowLevelSecurity: "on"` (the default) the mark was 0, every consumer counted as caught up, and the drain resolved after two dispatcher batches (400 events). A test behind a longer backlog then saw event-triggered jobs that had not run yet, so its result depended on how many events earlier tests in the same file had written. The drain now reads through the same cross-tenant runner as `stack.db`.
-->
