---
status: reference
verified: 2026-10-03
evidence: "kumiko-framework#3530; pipeline/event-retention.ts (pruneEvents), bundled-features/src/audit/run-escape-hatch-retention.ts"
---

# Measuring and reclaiming `kumiko_events` bloat

When `kumiko_events` is much larger than the data it holds, the file carries dead space from
deleted rows. This runbook measures that and gives the space back. It never deletes rows: only
`pruneEvents` removes events, called by the audit feature's retention job
(`audit:job:escape-hatch-retention`) and by an app's own retention jobs.

## 1. Measure (read-only)

Size of the table including indexes and TOAST, next to the plain heap size:

```sql
SELECT pg_size_pretty(pg_total_relation_size('kumiko_events')) AS total,
       pg_size_pretty(pg_relation_size('kumiko_events'))       AS heap,
       pg_size_pretty(pg_indexes_size('kumiko_events'))        AS indexes;
```

Dead rows and delete volume since the last statistics reset:

```sql
SELECT n_live_tup, n_dead_tup, n_tup_del, last_autovacuum, last_vacuum
FROM pg_stat_user_tables
WHERE relname = 'kumiko_events';
```

A high `n_tup_del` on a large table with few `n_live_tup` means a lot was deleted and the space
never went back to the operating system.

Events per aggregate type, to see what fills the table:

```sql
SELECT aggregate_type, count(*) AS events
FROM kumiko_events
GROUP BY aggregate_type
ORDER BY events DESC;
```

`escapeHatchUse` rows are the escape-hatch audit entries. The config key
`audit:config:escape-hatch-retention-days` sets how long they are kept (default 90 days).

## 2. Reclaim the space

A plain `VACUUM` (autovacuum included) only frees space for reuse inside the table. The file does
not shrink. Two ways shrink it:

- `VACUUM (FULL) kumiko_events;` rewrites the table while holding an `ACCESS EXCLUSIVE` lock, so
  every read and write on the events waits. Run it only in a maintenance window with the API and
  worker processes stopped.
- `pg_repack` rebuilds the table online and holds a lock only briefly. It needs the extension
  installed and a primary key (or a unique not-null index) on the table.

Both rebuild the indexes as part of the rewrite. If only the indexes are bloated and you skip the
rewrite, rebuild them without blocking writes:

```sql
REINDEX TABLE CONCURRENTLY kumiko_events;
```

Afterwards, run the queries from step 1 again and compare.
