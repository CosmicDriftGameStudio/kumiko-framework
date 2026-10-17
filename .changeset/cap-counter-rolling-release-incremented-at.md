---
"@cosmicdrift/kumiko-bundled-features": patch
---

Rolling cap release remembers the original booking time

<!-- kumiko-changes
feature: cap-counter
type: fix
title: Rolling cap release remembers the original booking time
detail: rolling-released events now carry the incrementedAt of the booking they return, so readRollingCapUsage no longer subtracts a release whose increment already left the rolling window.
-->
