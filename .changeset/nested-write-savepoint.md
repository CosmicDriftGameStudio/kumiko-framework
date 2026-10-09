---
"@cosmicdrift/kumiko-framework": patch
---

A nested `ctx.write` / `ctx.writeAs` (and workflow `call-feature`) now runs in a savepoint of the outer transaction: when the inner write fails after its event and projection were written, for example because an in-transaction hook throws, the inner change is rolled back even if the outer handler swallows the failure result and commits, and a SQL error in the inner write no longer poisons the outer transaction. The inner write's afterCommit hooks only run when it succeeded.

<!-- kumiko-changes
feature: framework
type: fix
title: A failed nested ctx.write is rolled back to a savepoint instead of leaking its event and projection into the outer commit
-->
