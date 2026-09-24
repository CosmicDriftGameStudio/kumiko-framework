---
"@cosmicdrift/kumiko-testing": patch
---

`resolveE2eWorkers` defaulted to a minimum of 2 workers. On a 1.5 CPU CI pod (publicstatus, 59 E2E tests) 1/2/4 workers measured 2.6/2.6/2.7 minutes — the runner is already CPU-saturated at 1 worker, so a higher minimum only adds scheduling overhead. The floor is now 1.

<!-- kumiko-changes
feature: testing
type: fix
title: E2E default worker count no longer floors at 2
-->
