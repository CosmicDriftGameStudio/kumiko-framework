---
"@cosmicdrift/kumiko-framework": patch
---

buildServer, runProdApp and the worker wake the event dispatcher via LISTEN/NOTIFY by default and poll only once per second as a safety net.

<!-- kumiko-changes
feature: event-store
type: improvement
title: Event dispatcher listens for new events by default
detail: Without an explicit `eventDispatcher.pgClient`, the dispatcher now subscribes to the events channel on `context.db` when that client supports LISTEN (Bun.SQL does). Production and worker processes therefore no longer poll kumiko_events every 100 ms around the clock. When a pgClient is wired and `pollIntervalMs` is not set, the safety poll runs every 1000 ms instead of 100 ms; an explicit `pollIntervalMs` still wins. A started dispatcher now runs a follow-up pass right after a consumer turn that delivered events or that absorbed a wake-up while it was running, and right after `withBackgroundPassesPaused` ends, so backlogs and wake-ups no longer wait for the next poll tick.
-->
