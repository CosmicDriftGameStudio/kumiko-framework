---
"@cosmicdrift/kumiko-bundled-features": patch
---

inbound-mail-foundation's ingest-message thread-rollup now serializes step 5 (live `messageCount`/`lastMessageAt` snapshot + append) per thread via `pg_advisory_xact_lock`. Closes a TOCTOU gap left open by #1229: a concurrent thread-rollup commit landing between the `countWhere` and `tryAppendEvent`'s own fresh version-read could make the append succeed with a stale count instead of surfacing a `VersionConflictError`, so the bounded retry loop never saw it as a conflict to retry — permanently undercounting `messageCount` within a single burst of concurrent ingests on the same thread (#2155).
