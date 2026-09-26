---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-types": patch
---

`concurrency: "sequential"` job lock now scoped by `queueNamePrefix`; corrected docs and test to the actual mutual-exclusion (not FIFO) contract

<!-- kumiko-changes
feature: framework
type: fix
title: Sequential-job lock key scoped by queueNamePrefix; contract clarified as mutual exclusion, not FIFO
detail: |
  The per-name Redis SETNX lock behind `concurrency: "sequential"` used a fixed `kumiko:lock:seq:<lane>:` key, unlike the queues themselves, which are scoped by `queueNamePrefix`. Two runners sharing a Redis but isolated by distinct prefixes (e.g. per-test-run prefixes) could collide on the same lock key even though their queues never saw each other's jobs. The key is now `kumiko:lock:seq:<queueNamePrefix>:<lane>:`. Separately, `JobDefinition.concurrency`'s doc comment and the integration test now state the contract precisely: "sequential" guarantees same-name dispatches never run concurrently, but does not guarantee they run in dispatch order. A lock loser is re-enqueued to the back of its queue, so a later dispatch can still complete before an earlier one. See fw#3265 for the local repro evidence backing this.
-->
