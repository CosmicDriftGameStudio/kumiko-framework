# Ledger Banking

Model bank accounts and transfers on the `ledger` primitive. This is the
simplest double-entry case: every account is an `asset`, a transfer is **one
balanced transaction**, and a balance is a **pure query** over the postings —
never a stored field you keep in sync.

## What it shows

A transfer moves money between two bank accounts as a single balanced transaction, and every balance is a pure query over the postings rather than a stored field you keep in sync.

- **A transfer is one transaction, not two updates** — moving €200 from
  checking to savings is a single `ledger:write:create-transaction` that debits
  savings (`+20000`) and credits checking (`−20000`). The two lines sum to 0,
  which is what makes the entry _balanced_; the framework rejects anything else.
- **Balances are derived, never stored** — there is no `balance` column on an
  account. `ledger:query:report:balances` sums the postings on the fly and
  applies each account's natural sign (asset = debit-normal).
- **The trial balance is the safety net** — because every entry sums to 0, the
  sum of _all_ postings is always 0. The flow asserts it after the transfers:
  if it ever drifts, the books are inconsistent.
- **Cents are signed integers** — amounts are integer minor units; `+` is a
  debit, `−` is a credit. No floats, no rounding drift.

## The banking flow

The flow below is embedded from `usage.ts` and is run end-to-end against the
real dispatcher + DB by this recipe's integration test (`the documented
bankingFlow …`):

```ts file=<rootDir>/_samples/recipes-ledger-banking/src/usage.ts
```

## Why no `feature.ts`?

Unlike most recipes, banking mounts no host feature — the `ledger` bundle _is_
the host. Accounts and transactions are its own entities, so the recipe just
dispatches `ledger:*` handlers. Mount it once with `createLedgerFeature()` and
the whole chart of accounts + journal is available.

## Run

```bash
bun test src/__tests__/feature.integration.test.ts
```
