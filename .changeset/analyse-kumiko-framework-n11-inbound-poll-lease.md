---
"@cosmicdrift/kumiko-bundled-features": patch
---

The reconciliation poll of the inbound-mail supervisor fetches each mailbox once per interval across all workers.

<!-- kumiko-changes
feature: inbound-mail-foundation
type: improvement
title: One reconciliation poll per mailbox across workers
detail: With several workers every worker polled every mailbox each interval, so two workers doubled the IMAP logins per mailbox. A scheduled poll tick, and the first poll of `start()`, now claims a per-mailbox lease `<accountId>:poll` on the supervisor's `lock` for one poll interval minus one second; a worker without it skips the fetch for that mailbox but still checks its watcher. `stop()` releases the held poll leases so a peer polls in its next tick. If the lock throws, the worker polls anyway, because ingest deduplicates. `pollOnce()`, wake syncs and `syncAccountNow` do not take the lease. The key ends in `:poll`, so a lock prefix shared with the watch lease keeps working and scripts that look for `:<accountId>` still find only the watch lease.
-->
