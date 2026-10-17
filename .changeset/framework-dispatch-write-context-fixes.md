---
"@cosmicdrift/kumiko-framework": patch
---

Write context fixes: stream version read, nested write serialization, ctx.notify through the query bridge

<!-- kumiko-changes
feature: framework
type: fix
title: fetchForWriting reads one consistent stream version, nested ctx.write calls run in order, ctx.notify works through ctx.query
detail: fetchForWriting derives the stream version from the same events it loads instead of a second read. Parallel ctx.write calls on one transaction are serialized, so a failing write rolls back only its own savepoint and no longer takes a concurrent successful write with it. ctx.notify called inside a handler reached through ctx.query is deferred onto the outer write's after-commit list instead of being delivered before that write commits. ctx.notify snapshots its options when it is called, so later mutation by the handler does not change the delivered notification. The JSDoc of AggregateStreamHandle.appendOne now states that it must not be mixed with other appends to the same aggregate in one handler.
-->
