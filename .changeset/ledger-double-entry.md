---
"@cosmicdrift/kumiko-bundled-features": minor
---

feat(ledger): double-entry bookkeeping primitive

New `ledger` bundled feature — a host-agnostic double-entry primitive. Owns the
per-tenant `account` chart of accounts and immutable `transaction` journal
entries (balanced posting lines, Σ = 0, signed integer minor units; corrections
via reverse-transaction Storno, no update/delete). Account balances, P&L, and
balance sheet derive as pure queries over the postings. Mount with
`createLedgerFeature({ roles | access, toggleable })`. Ships `ledger-banking`
and `ledger-invoicing` sample recipes.
