---
"@cosmicdrift/kumiko-framework": patch
---

setupTestStack isolates job queues per stack by default

<!-- kumiko-changes
feature: framework
type: fix
title: setupTestStack isolates job queues per stack by default
detail: |
  BullMQ queues live on the raw Redis URL, outside the per-test keyPrefix, so
  two parallel test stacks with `jobs` and no explicit `queueNamePrefix` shared
  the prod default queue names and one stack's consumer could run the other
  stack's jobs. setupTestStack/setupAppTestStack now derive a unique
  `queueNamePrefix` from the stack's test Redis keyPrefix. An explicit
  `jobs.queueNamePrefix` still wins; pass the same value to every runner that
  has to share a stack's queues. createJobRunner and the prod path are unchanged.
-->
