---
"@cosmicdrift/kumiko-framework": patch
---

Job runner keeps its cron schedulers marked as seen and waits for an abandoned boot gate in stop()

<!-- kumiko-changes
feature: framework
type: fix
title: Cron schedulers of a running job runner survive orphan cleanup by an older runner, and stop() waits for a timed-out boot gate
detail: The runner re-stamps its own cron schedulers in the orphan-cleanup seen hash every quarter of the grace period (one hset for all ids, cleared in stop()), so a mixed-version window longer than an hour no longer lets an older runner delete a scheduler a live runner holds. The stamps are written before the schedulers are upserted. A boot gate that exceeds its timeout is abandoned, not aborted: its handler keeps running, and stop() now waits for it (bounded) before closing connections.
-->
