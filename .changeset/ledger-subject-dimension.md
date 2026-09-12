---
"@cosmicdrift/kumiko-bundled-features": minor
---

Ledger `transaction` and `schedule` gain two optional, filterable fields, `subjectType` and `subjectId`, naming the business object a booking or standing order is about (e.g. a lease contract) so entries can be queried by `eq`/`in` filters instead of only carrying that reference as a prefix inside the free-text `reference` field. A composite `(tenantId, subjectType, subjectId)` index backs those filters. `confirm-schedule-period` copies the subject from the schedule onto the transaction it books — the caller no longer repeats it per period. Both fields are optional and default to absent: existing transactions and schedules without a subject remain valid and behave exactly as before.
