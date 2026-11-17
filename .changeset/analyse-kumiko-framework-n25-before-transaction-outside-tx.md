---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-types": patch
---

beforeTransaction can write through ctx.db.outsideTransaction.

<!-- kumiko-changes
feature: framework
type: improvement
title: beforeTransaction keeps outsideTransaction
detail: Like `reserveBeforeTransaction`, the `beforeTransaction` phase keeps `ctx.db.outsideTransaction` and `ctx.systemDb.outsideTransaction`; `ctx.db` itself stays read-only. A long external call in this phase can record metering, provenance or an idempotency record that survives a failing handler, without `transaction: "perCommand"`. `BeforeTransactionContext` is an alias of `ReservationContext`.
-->
