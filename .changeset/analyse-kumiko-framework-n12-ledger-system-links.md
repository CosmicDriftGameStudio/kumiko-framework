---
"@cosmicdrift/kumiko-bundled-features": minor
---

Ledger transactions keep their system links in their own columns; `reference` is display text only.

<!-- kumiko-changes
feature: ledger
type: breaking
title: Ledger reversal and schedule links moved out of reference
detail: Reversals set reversesTransactionId (unique per tenant), confirmed schedule periods set scheduleId and period, and the Storno copies scheduleId, period and subject from its original. create-transaction accepts an optional period but can no longer forge a reversal or a booked period through reference. Reversing a Storno is rejected with transaction_is_reversal. scheduleReference was removed; findReversedIds and LedgerTxRow use the new columns.
migration: Replace scheduleReference matching with LedgerTxRow.scheduleId/period and read reversals via reversesTransactionId. Load schedule bookings with ledger:query:schedule-actuals instead of paging the transaction list. Transaction events are now eventVersion 2; an upcaster derives reversesTransactionId from a v1 Storno's reference and scheduleId/period from `schedule:<id>:<period>` (a v1 Storno copies them from its original), so rebuilding read_ledger_transactions restores the links of existing bookings.
affects: ledger, scheduleReference, LedgerTxRow, findReversedIds
-->
