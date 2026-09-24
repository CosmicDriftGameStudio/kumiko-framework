---
"@cosmicdrift/kumiko-bundled-features": patch
---

`enforceCap` and `enforceCapAndMaybeNotify` take an optional `amount`, matching `bookCapUsage`: a caller booking several units checks them in one read with the same outcome as checking them one by one, instead of looping check-then-book per unit.

<!-- kumiko-changes
feature: cap-counter
type: improvement
title: enforceCap accepts an amount for multi-unit bookings
-->
