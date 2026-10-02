---
"@cosmicdrift/kumiko-framework": patch
---

A `bootGate` job that hangs now rejects `start()` with a message naming the gate once its `timeout` (default 60s) elapses, instead of blocking boot silently.

<!-- kumiko-changes
feature: framework
type: fix
title: Boot gates are bounded by the job timeout (default 60s) and name the hung gate
-->
