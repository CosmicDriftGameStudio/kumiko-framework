---
"@cosmicdrift/kumiko-bundled-features": patch
---

The waitlist `notifyRecipient` resolver now runs with a `ctx.systemDb` bound to its own savepoint. Before, a resolver whose SQL statement failed (missing table, constraint, timeout) put the submit transaction into the aborted state: the submit answered 500 and stored no entry, although the JS error was caught. Now the savepoint rolls back and the entry is stored. Statements through other `ctx` handles (`ctx.query`, `ctx.write`) still share the submit transaction.

<!-- kumiko-changes
feature: waitlist
type: fix
title: A failing notifyRecipient SQL statement no longer aborts the submit
detail: The resolver receives a ctx whose systemDb runs in a savepoint, so a failed statement is rolled back and the submit answers 200 with the entry stored. Only ctx.systemDb is savepoint-scoped; other ctx handles stay in the handler transaction.
-->
