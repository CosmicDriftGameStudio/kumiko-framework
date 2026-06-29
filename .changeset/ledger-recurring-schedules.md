---
"@cosmicdrift/kumiko-bundled-features": minor
---

ledger: recurring schedules (Dauerauftrag) layered on the double-entry primitive. A `schedule` entity (debit/credit accounts, amount, monthly interval) yields the Soll as a pure projection (`projectSchedule`) that needs no bookings, while `confirm-schedule-period` materialises one period as an idempotent, reversal-aware balanced entry referencing `scheduleReference(id, period)`. `mergeScheduleActuals` merges Soll vs. Ist (posted | open | forecast), with a stornoed month dropping back to open + re-confirmable. Forecast without booking every month; only confirming writes.
