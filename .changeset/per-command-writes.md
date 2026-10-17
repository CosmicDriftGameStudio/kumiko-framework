---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
---

Writes without an open transaction run as their own command

<!-- kumiko-changes
feature: framework
type: breaking
title: Writes without an open transaction run as their own command; ctx.db writes there throw
detail: Write handlers accept transaction "perCommand". Such a handler runs without a transaction of its own, so every ctx.write and ctx.writeAs it issues runs as its own top-level command with its own transaction, gates and afterCommit hooks. A perCommand handler cannot run as a nested ctx.write, cannot be part of a multi-command batch (422 per_command_handler_in_batch) and cannot combine with beforeTransaction or reserveBeforeTransaction (boot error). ctx.write and ctx.writeAs from stream handlers and top-level query handlers now take the same route, so afterCommit hooks of the called write, which never fired before, fire now. ctx.db writes (entity executor, insertOne, updateMany, deleteMany, db.global() writes) and event appends (appendEvent, unsafeAppendEvent, tryAppendEvent, fetchForWriting, archiveStream, restoreStream, snapshotAggregate) throw in stream handlers, top-level query handlers, perCommand handlers and in beforeTransaction and reserveBeforeTransaction. ctx.dbOutsideTransaction and ctx.outsideTransaction stay available, and ctx.db.unsafeRaw stays open as the audited escape hatch.
migration: Stream and query code that writes through ctx.db or an executor bound to ctx.db calls a write handler through ctx.write or ctx.writeAs instead, or writes deliberately through ctx.dbOutsideTransaction. Check code that relied on afterCommit hooks of a write called from a stream or query handler not firing. bookCapUsage from a stream or query handler needs outsideTransaction true or a command. runInOwnTransaction(ctx.db, ...) stays locked in these contexts; runInOwnTransaction(ctx.dbOutsideTransaction, ...) is the way to a deliberate own transaction. Measured consumers: one stream handler (AI agent turn: conversation, activity and tool-call records through an executor on ctx.db, plus cap booking) and one query handler (AI text run: cap booking on ctx.db, log via ctx.write). No other consumer app has stream or query writes. The beforeTransaction/reserveBeforeTransaction lock affects no released code.
-->
