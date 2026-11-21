---
"@cosmicdrift/kumiko-framework": patch
---

A re-created cron scheduler yields when the other wake flag's scheduler appeared meanwhile, so a rolling update no longer fires the job twice per slot.

<!-- kumiko-changes
feature: framework
type: fix
title: Cron scheduler no longer doubles after a rolling update
detail: The refresh tick that re-creates missing cron schedulers lists first and upserts later without a lock. When a newer runner with the other `wakesSleepingApp` flag started in between and removed the older id as superseded, the older runner brought its id back and both existed. After the upsert the runner now reads the scheduler ids again and removes the id it just created if the other flag's id exists. If both runners create at the same moment, both yield and the next tick creates one.
-->
