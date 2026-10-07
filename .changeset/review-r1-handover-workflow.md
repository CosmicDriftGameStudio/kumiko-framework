---
"@cosmicdrift/kumiko-bundled-features": patch
---

Tenant handover only fails with `transfer_graph_too_deep` when rows really hang below the fifth hop, and failed workflow runs report the suspended step

A claim used to fail whenever the last round's entity type had outgoing edges, even with no rows behind them, so a chain of exactly five hops with an unrestricted `parentRef` entity registered was rejected. `workflow.run-failed` carries the real `stepIndex` for the unsupported-suspension case instead of always 0.

<!-- kumiko-changes
feature: tenant-handover
type: fix
title: Tenant handover claims fail with transfer_graph_too_deep only when rows exist beyond the last allowed hop
-->

<!-- kumiko-changes
feature: workflow-runner
type: fix
title: workflow.run-failed carries the real stepIndex when a run suspends in an unsupported step
-->
