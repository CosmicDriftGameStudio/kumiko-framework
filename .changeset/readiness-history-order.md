---
"@cosmicdrift/kumiko-bundled-features": patch
---

The system-check history lists the newest run first even when two runs start in the same second.

<!-- kumiko-changes
feature: readiness
type: fix
title: System-check history keeps runs of the same second in order
detail: `probe-run:list` returned `requestedAt` as `Instant.toString()`, which drops trailing zeros in the fraction, and `pageRows` sorts that field as a string. Two runs in the same second could then come out reversed (`…:20Z` sorted after `…:20.001Z`), so the history showed the older run on top and a click opened it. `requestedAt` now always carries six fractional digits, so string order matches time order.
-->
