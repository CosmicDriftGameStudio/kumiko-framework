---
"@cosmicdrift/kumiko-guards": patch
---

A guard without a baseline file and without findings passes quietly

Guards with a baseline ratchet printed the "No baseline found" warning in every consumer, even when they found nothing. A missing baseline now counts as an empty one when the current count is zero. `raw-sql` uses the same ratchet.

<!-- kumiko-changes
feature: guards
type: fix
title: A missing guard baseline with zero findings is clean instead of warning
-->
