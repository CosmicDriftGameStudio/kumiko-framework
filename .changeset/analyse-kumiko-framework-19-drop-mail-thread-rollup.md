---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-framework": minor
---

inbound-mail-foundation no longer keeps a mail-thread rollup, and `kumiko schema generate` drops `read_mail_threads`.

<!-- kumiko-changes
feature: inbound-mail-foundation
type: breaking
title: Mail-thread rollup and read_mail_threads removed
detail: Every ingest took a per-thread lock, counted the thread's messages, encrypted the subject and appended a `mail-thread-updated` event, but nothing read `read_mail_threads`. Ingest now writes only the message. `threadKey` stays on every message and in the ingest result, and `message:list` still filters by it. Removed: the `mail-thread-updated` event, the `mail-thread` projection and its tenant-destroy hook, the ingest result field `threadAggregateId`, and the exports `mailThreadAggregateId`, `mailThreadEntity`, `mailThreadsProjectionTable`, `MAIL_THREAD_PII_FIELDS`, `MAIL_THREAD_AGGREGATE_TYPE`, `MAIL_THREAD_UPDATED_EVENT_QN`, `MAIL_THREAD_UPDATED_EVENT_SHORT`, `MailThreadEventPayload` and `mailThreadEventPayloadSchema`. `read_mail_threads` is now a retired framework table, so `kumiko schema generate` drops it. The ingest handler no longer declares an `unsafeRaw` escape hatch.
migration: Run `kumiko schema generate` and apply the migration. Remove `mailThreadEntity` from test table lists. Old `mail-thread-updated` events stay unread in the event log; `kumiko events prune --aggregate-type mail-thread --apply` removes them.
-->
