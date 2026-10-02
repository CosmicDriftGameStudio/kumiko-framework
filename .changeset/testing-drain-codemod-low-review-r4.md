---
"@cosmicdrift/kumiko-framework": patch
---

`drainEventConsumers` rejects a non-positive or non-integer `maxPasses` instead of returning without draining, and `drainJobs` accepts `timeoutMs` (default 10s) and fails a stuck drain with the pending job count and the consumers still behind. The stance report names which hint category (direct, user-owned, user-reference) a near-miss field resembles, and the `UnprocessableError` reason codemod no longer reports spread literals without a `reason` key and lists non-analyzable `details` arguments as unverified.

<!-- kumiko-changes
feature: framework
type: fix
title: drainEventConsumers rejects an invalid maxPasses and drainJobs fails a stuck drain with a diagnosis
-->

<!-- kumiko-changes
feature: framework
type: improvement
title: Codemod reports name the near-miss hint category and separate unverified sites from manual skips
-->
