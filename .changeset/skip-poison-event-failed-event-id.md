---
"@cosmicdrift/kumiko-framework": patch
---

New column `kumiko_event_consumers.last_failed_event_id` (created by the boot bootstrap, no app migration). `skipPoisonEvent` now skips the event that actually failed.

<!-- kumiko-changes
feature: framework
type: fix
title: skipPoisonEvent skips the actually failed event via kumiko_event_consumers.last_failed_event_id
-->
