---
"@cosmicdrift/kumiko-testing": minor
---

Adds `createBarrier` and `burst` to `@cosmicdrift/kumiko-testing/helpers` and exposes the resolved pool size as `TestStack.dbPoolMax`, so concurrency tests prove that handler calls overlapped instead of racing a sleep.

<!-- kumiko-changes
feature: testing
type: improvement
title: Deterministic concurrency test helpers
detail: createBarrier proves handler calls overlapped, burst fires N requests and tallies statuses with a guard against the pool size, TestStack exposes dbPoolMax.
-->
