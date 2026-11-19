---
"@cosmicdrift/kumiko-framework": patch
---

The event dispatcher reads the event head once per pass for the consumer lag metric instead of once per consumer turn.

<!-- kumiko-changes
feature: framework
type: improvement
title: Consumer lag metric reads the event head once per pass
detail: Every active consumer turn used to run its own MAX(id) query on kumiko_events only to emit `kumiko_event_consumer_lag_events`. The head is the same for all consumers of a pass, so the first turn that needs it reads it and the other turns of that pass reuse the value. The lag can be a few events lower than before when events commit during the pass; it is still clamped at 0.
-->
