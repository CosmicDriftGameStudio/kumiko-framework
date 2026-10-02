---
"@cosmicdrift/kumiko-bundled-features": patch
---

The workflow resume job now picks up at most 100 due runs per tick, oldest first, so a backlog drains over several ticks. Tenant handover merges rows discovered per entity type so each outgoing edge runs once per round.

<!-- kumiko-changes
feature: bundled-features
type: fix
title: workflow resume batches due runs, tenant handover merges discovered rows per type
-->
