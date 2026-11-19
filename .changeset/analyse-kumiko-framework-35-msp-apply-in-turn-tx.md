---
"@cosmicdrift/kumiko-framework": patch
---

A multi-stream projection's apply now commits together with its consumer cursor.

<!-- kumiko-changes
feature: framework
type: fix
title: MSP apply runs in the dispatcher's turn transaction
detail: The apply of an `r.multiStreamProjection` runs in a savepoint on the event-dispatcher's turn transaction instead of on the connection pool. Its writes and `ctx.events.append` calls commit with the cursor, so a crash between apply and cursor write no longer applies the event twice, and a throwing apply leaves no partial writes behind. Side effects outside the database (dispatched jobs, external calls, derivatives) stay at-least-once. `EventConsumerHandler` receives the turn as an optional third argument.
-->
