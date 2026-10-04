---
"@cosmicdrift/kumiko-bundled-features": patch
---

step-dispatcher no longer re-sends after a failed key erase

When erasing the per-dispatch key failed after the outcome was recorded, the redelivered request was sent again and produced a second `step.dispatched`. A redelivery now only repeats the erase.

<!-- kumiko-changes
feature: step-dispatcher
type: fix
title: A failed key erase no longer causes a second delivery of the same dispatch request
-->
