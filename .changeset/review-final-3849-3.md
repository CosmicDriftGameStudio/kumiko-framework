---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-testing": patch
---

The upload ledger stamps rows with the injected `AppContext.clock` (the source behind `ctx.tz`) instead of the wall clock, so the orphan-upload sweep and the ledger agree under a controlled clock. The test stack passes its `extraContext.clock` through.

<!-- kumiko-changes
feature: framework
type: fix
title: upload ledger uses the injected clock
detail: createFileUploadLedger and withUploadLedger take an optional now function, and the file provider resolver wires AppContext.clock into it. Without a clock the system time is used as before.
-->
