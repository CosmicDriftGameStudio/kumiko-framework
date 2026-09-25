---
"@cosmicdrift/kumiko-framework": minor
---

r.job triggers can filter on payload fields via JobTrigger.where

A job's {on} trigger can now carry an optional where: equality filter on top-level event-payload fields, checked in job-runner's handleEvent before the job is enqueued (both the sync write-handler dispatch path and the async event-consumer path share this check). Lets N jobs share one broad event QN, partitioned by a payload discriminant, instead of each needing its own narrow event type.

<!-- kumiko-changes
feature: framework
type: improvement
title: r.job triggers can filter on payload fields via JobTrigger.where
-->
