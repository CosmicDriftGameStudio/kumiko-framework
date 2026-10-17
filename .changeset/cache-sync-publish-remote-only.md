---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-types": patch
---

CacheSyncBus.publish accepts remoteOnly to skip local listeners

<!-- kumiko-changes
feature: framework
type: improvement
title: CacheSyncBus.publish takes { remoteOnly } to skip same-process listeners
detail: `publish(topic, message, { remoteOnly: true })` delivers only to other processes. Use it when the publisher has already applied the change locally and a local fanout would trigger a redundant reload.
-->
