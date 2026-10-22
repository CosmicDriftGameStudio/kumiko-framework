---
"@cosmicdrift/kumiko-bundled-features": patch
---

A calendar cap settle on a swept or released reservation books the actual amount before it writes the settle tombstone, so a lost counter version race no longer commits a tombstone without the booking. A test now races several such settles on one counter and expects the full amount.

<!-- kumiko-changes
feature: cap-counter
type: fix
title: Settle after a sweep survives a lost counter race
detail: The amount is booked first and the tombstone written afterwards, so a version conflict on the counter retries the whole settle instead of leaving a tombstone that turns the retry into a no-op and drops the usage from the cap.
-->
