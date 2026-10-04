---
"@cosmicdrift/kumiko-framework": patch
---

Boot warning and docs no longer claim SSE is per instance

The built-in SSE consumers share one cursor since fw#2625 and fw#2630. The missing-`KUMIKO_INSTANCE_ID` warning, the consumer-state comment and `docs/reference/infra-requirements.md` now say what the id is still for (the `app.started` event and per-instance consumers) and recommend the pod name.

<!-- kumiko-changes
feature: framework
type: fix
title: Missing-instance-id warning and docs reflect shared SSE delivery and recommend the pod name
-->
