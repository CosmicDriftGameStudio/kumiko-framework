---
"@cosmicdrift/kumiko-framework": patch
---

Database work in an afterCommit hook silently ran outside any transaction. `runInSavepointIfSupported` caught the `25P01` from the committed handle and executed the callback anyway. It now throws an `InternalError` naming the cause and both escape hatches (`HookPhases.inTransaction`, `ctx.dbOutsideTransaction`), and `dispatch-write` builds the afterCommit handler context fresh at flush time instead of closing over the transaction's.
