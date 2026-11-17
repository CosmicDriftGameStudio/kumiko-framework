---
"@cosmicdrift/kumiko-framework": minor
---

A projection rebuild now fails when an apply writes any table other than its own projection table.

<!-- kumiko-changes
feature: projections
type: breaking
title: Rebuild guards the single-table contract
detail: During a rebuild only the projection's own table points at the shadow schema; any other table an apply writes is the live table, so a multi-table apply corrupted live data during an online rebuild. Single-stream and multi-stream rebuilds now compare `pg_stat_xact_user_tables` before and after the replay and abort the rebuild transaction, naming the tables, if any table outside the rebuild schema was written.
migration: A projection or multi-stream projection whose apply writes a second table must split that write into its own projection or a side-effect consumer; until then its rebuild fails with the table name.
-->
