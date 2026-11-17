---
"@cosmicdrift/kumiko-bundled-features": patch
---

Ledger transactions take an optional `sourceRef`, so a caller books an entry at most once per tenant.

<!-- kumiko-changes
feature: ledger
type: improvement
title: create-transaction books at most once per sourceRef
detail: `transaction` has an optional `sourceRef` (up to 128 characters, filterable), unique per tenant through the partial index `read_ledger_transactions_tenant_id_source_ref_uidx`. `create-transaction` with a `sourceRef` that is already booked in the tenant books nothing and returns the existing entry as `{ id, alreadyBooked: true }`; a new booking returns `alreadyBooked: false`. Parallel calls with the same key are serialized, so only one entry is booked. The key stays with its entry after a reversal, so booking again after a Storno needs a new key. Entries without `sourceRef` behave as before.
migration: Apps that mount ledger run `kumiko-schema generate` and ship the migration that adds `read_ledger_transactions.source_ref` and its unique index. Callers that guard repeat bookings by searching `reference` pass `sourceRef` instead.
-->
