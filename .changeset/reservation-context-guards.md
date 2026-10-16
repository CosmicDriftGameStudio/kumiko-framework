---
"@cosmicdrift/kumiko-framework": patch
---

Reservation contexts reject transaction-bound writes

<!-- kumiko-changes
feature: framework
type: fix
title: reserveBeforeTransaction contexts now reject writes that would escape the transaction
detail: The context passed to reserveBeforeTransaction now throws on ctx.write, writeAs, event appends, scheduleAfterCommit, notify and jobRunner, like the beforeTransaction phase does. dbOutsideTransaction, outsideTransaction and forTenant stay available because reservations deliberately write outside the transaction.
-->
