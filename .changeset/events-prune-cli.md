---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-dev-server": patch
---

New `events prune` command removes whole aggregate types from the event log.

<!-- kumiko-changes
feature: framework
type: improvement
title: events prune removes retired aggregate types from the event log
detail: `@cosmicdrift/kumiko-framework/events-cli` exports `runEventsCli(argv, out, { features, rowLevelSecurity? })`. `events prune --aggregate-type <type> [--aggregate-type <type> ...]` reports events, aggregates and tenants per type; with `--apply` it deletes, in one transaction and in system scope, the events, snapshots, archive markers and dead letters of these types and empties the projections fed only by them. A projection that also reads other types makes the run refuse. Unknown or empty types fail without deleting anything. Use it when old events of a retired type break the rebuild of `schema apply`. Apps add `if (cmd === "events")` to `bin/kumiko.ts`; new scaffolds get it.
-->

<!-- kumiko-changes
feature: dev-server
type: improvement
title: Scaffolded bin/kumiko.ts dispatches events
detail: The generated standalone CLI now forwards `events` to `runEventsCli` with the app's features and row level security mode.
-->
