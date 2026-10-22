---
"@cosmicdrift/kumiko-framework": patch
---

The per-process audit dedup of system cron escape hatches keys a target only for `global-write`, where it names a table. A `cross-tenant-read` cron no longer adds a dedup entry and an audit event per touched foreign row; it audits once per day and process. Entries older than the re-audit interval were already swept.

<!-- kumiko-changes
feature: framework
type: fix
title: Cross-tenant-read crons audit once per day, not once per foreign row
detail: The process dedup key of a declared system cron hatch includes the target only for global-write (a table). Row targets of cross-tenant-read no longer grow the in-memory map or write one audit event per row.
-->
