---
"@cosmicdrift/kumiko-framework": patch
---

EventDispatcher gains drain() for race-free test teardown

New `EventDispatcher.drain(): Promise<void>` waits out a pass already in flight (the timer tick or LISTEN/NOTIFY wake-up a suite's own `.start()` triggered) without touching the timer or the LISTEN subscription — unlike `stop()`, the dispatcher keeps running afterwards. `stack/table-helpers.ts`'s `resetEventStore` now calls it before truncating `kumiko_events` and the other framework tables, so a beforeEach/afterEach reset can no longer race a pass this same dispatcher started (kumiko-framework#3017): every suite that calls `resetEventStore` after starting the dispatcher (directly or via `jobs`) inherits the fix automatically. No behavior change for suites that never start the dispatcher — `drain()` is then a no-op, since nothing is ever in flight.

<!-- kumiko-changes
feature: framework
type: fix
title: EventDispatcher gains drain() for race-free test teardown
-->
