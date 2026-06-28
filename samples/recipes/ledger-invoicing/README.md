# Ledger Invoicing

Model accrual invoicing (Rechnungswesen) on the `ledger` primitive. Issuing an
invoice and receiving its payment are **two separate transactions**, and
revenue is recognised when the invoice is **issued** — not when the cash
arrives. This is the difference between banking (cash moves) and accounting
(obligations are recorded as they arise).

## What it shows

Accrual accounting recognises revenue when an invoice is issued, not when the cash arrives: the invoice and its payment are two separate transactions, VAT is held as a liability, and the receivable clears to zero once paid.

- **Accrual: revenue at invoice time** — issuing the invoice debits Forderungen
  (accounts receivable) and credits Erlöse (income). The revenue is on the P&L
  immediately; the flow asserts it via `report:income-statement` _before_ any
  payment exists.
- **VAT is a liability, not income** — the gross €1,190 splits into €1,000 net
  revenue and €190 Umsatzsteuer. The VAT is money you owe the tax office, so it
  lands on a `liability` account, never inflating revenue.
- **The receivable has a lifecycle** — it's raised at the gross amount on
  invoice and cleared to 0 on payment (debit Bank / credit Forderungen). An open
  receivable balance _is_ your "unpaid invoices" total, with no extra bookkeeping.
- **Reports re-derive, payment doesn't double-count income** — booking the
  payment moves cash and settles the receivable; it touches no income account,
  so revenue stays €1,000.

## The invoicing flow

The flow below is embedded from `usage.ts` and is run end-to-end against the
real dispatcher + DB by this recipe's integration test (`the documented
invoicingFlow …`):

```ts file=<rootDir>/_samples/recipes-ledger-invoicing/src/usage.ts
```

## Banking vs. invoicing

Both recipes use the same primitive — accounts + balanced transactions — but
record different things:

| | [ledger-banking](../ledger-banking/) | ledger-invoicing |
|---|---|---|
| Accounts | all `asset` (bank accounts) | `asset` + `income` + `liability` |
| A transaction is… | a transfer (cash moves) | an obligation (invoice) or its settlement |
| Revenue recognised | n/a | at invoice time (accrual) |
| Reports surfaced | balances | balances + P&L |

## Run

```bash
bun test src/__tests__/feature.integration.test.ts
```
