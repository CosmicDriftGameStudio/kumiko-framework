---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

Tests now prove that the echoed write event is absent from `dispatcher.write` and `dispatcher.batch` results and from agent tool call results, the entry points used by websocket writes, agent tools and jobs.

<!-- kumiko-changes
feature: framework
type: improvement
title: event-free write results proven for non-HTTP entry points
detail: Integration tests assert that dispatcher.write, dispatcher.batch and the agent tool dispatch return no event. No runtime change: all of them already pass through the dispatcher masking.
-->
