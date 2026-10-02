---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-renderer": patch
---

Anonymous SSE signals no longer carry row id or version

An anonymous /api/sse connection gets every row signal of a declared liveEntities entity, including rows the anonymous query hides. The frame now carries only aggregateType, eventType and createdAt, so a public viewer can no longer see which hidden rows exist or change; signed-in connections keep id and version. LiveEvent.data.id and version are optional in kumiko-renderer accordingly.

<!-- kumiko-changes
feature: framework
type: fix
title: Anonymous SSE signals no longer carry row id or version
-->
