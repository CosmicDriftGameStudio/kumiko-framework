---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-types": patch
---

pruneEvents accepts batchSize and handler contexts carry an after-commit notify factory

<!-- kumiko-changes
feature: framework
type: improvement
title: pruneEvents batchSize and _notifyAfterCommitFactory on the handler context
detail: pruneEvents takes an optional batchSize that deletes the lowest event ids first, so callers can loop until deletedCount is below the batch size with one short transaction per batch. The handler context exposes _notifyAfterCommitFactory, a notify factory bound to the dispatcher's job runner for use after the transaction has committed.
-->
