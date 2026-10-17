---
"@cosmicdrift/kumiko-framework": patch
---

A throwing command in a batch without a database connection releases its cap reservation

<!-- kumiko-changes
feature: framework
type: fix
title: A throwing command in a batch without a database connection releases its cap reservation
detail: The sequential fallback of dispatchBatch (no DB connection) did not release the reserved capacity when a command threw instead of returning a failure result. It now releases the reservation before rethrowing.
-->
