---
"@cosmicdrift/kumiko-framework": patch
---

A `bootGate` job with an explicit `timeout` now rejects `start()` with a message naming the gate once that timeout elapses. Without `timeout` the gate keeps waiting and logs a warning naming it after 60s instead of blocking boot silently.

<!-- kumiko-changes
feature: framework
type: fix
title: Boot gates with an explicit timeout reject start() naming the gate; gates without one warn after 60s
-->
