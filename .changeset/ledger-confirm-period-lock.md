---
"@cosmicdrift/kumiko-bundled-features": patch
---

ledger: `confirm-schedule-period` serializes concurrent confirms of the same (tenant, schedule period) with an advisory lock, so direct calls can no longer double-book.
