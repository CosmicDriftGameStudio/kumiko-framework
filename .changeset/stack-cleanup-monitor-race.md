---
"@cosmicdrift/kumiko-testing": patch
---

The stack cleanup test no longer fails on the ioredis MONITOR startup race.

<!-- kumiko-changes
feature: testing
type: fix
title: Stack cleanup test tolerates the ioredis MONITOR startup race
detail: ioredis switches a connection to monitoring one microtask after MONITOR's OK, so command lines in the same TCP read raised "Command queue state error" and failed the cleanup test under parallel Redis traffic. The test opens its own monitor connection and drops only that startup error.
-->
