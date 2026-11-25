---
"@cosmicdrift/kumiko-bundled-features": patch
---

The letter poll job skips quietly in production while the live switch is off instead of failing every run

Sending a letter still refuses while the switch is off; with the switch on, a missing provider still fails the poll.

<!-- kumiko-changes
feature: letter-foundation
type: fix
title: The letter poll job skips quietly in production while the live switch is off instead of failing every run
-->
