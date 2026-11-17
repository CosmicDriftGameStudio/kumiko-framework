---
"@cosmicdrift/kumiko-framework": patch
---

Addressed live signals from a write go out after the commit.

<!-- kumiko-changes
feature: framework
type: fix
title: Live signals wait for the commit
detail: Inside a write handler, `ctx.services.userLiveSignals.push` queues the SSE frames and sends them after the transaction commits, through the same sink as `ctx.notify`. A rolled-back write sends nothing. Outside a transaction the frames go out at once, as before.
-->
