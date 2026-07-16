// Ledger Invoicing — accrual accounting (Rechnungswesen).
//
// Issuing an invoice and receiving its payment are TWO separate transactions,
// and revenue is recognised when the invoice is ISSUED (accrual), not when the
// cash arrives:
//
//   1. Issue:   debit Forderungen (asset, accounts receivable) for the GROSS
//               amount, credit Erlöse (income) for the NET and Umsatzsteuer
//               (liability) for the VAT. Revenue hits the P&L now.
//   2. Payment: debit Bank (asset), credit Forderungen — the receivable nets
//               back to 0 once the customer has paid.
//
// This recipe's integration test runs `invoicingFlow` below against the real
// dispatcher + DB.

import {
  type AccountType,
  LedgerHandlers,
  LedgerQueries,
} from "@cosmicdrift/kumiko-bundled-features/ledger";

export type LedgerClient = {
  write: <T>(type: string, payload: unknown) => Promise<T>;
  query: <T>(type: string, payload: unknown) => Promise<T>;
};

type BalancesReport = {
  accounts: Array<{ id: string; name: string; balance: number }>;
  trialBalance: number;
};

async function openAccount(client: LedgerClient, name: string, type: AccountType): Promise<string> {
  const { id } = await client.write<{ id: string }>(LedgerHandlers.createAccount, { name, type });
  return id;
}

// Issue an invoice, observe that the revenue is already on the P&L before any
// cash moves, then book the incoming payment. Returns the figures the test
// asserts: accrual revenue, the cleared receivable, cash in, VAT owed.
export async function invoicingFlow(client: LedgerClient) {
  const receivables = await openAccount(client, "Forderungen", "asset");
  const revenue = await openAccount(client, "Erlöse", "income");
  const vat = await openAccount(client, "Umsatzsteuer", "liability");
  const bank = await openAccount(client, "Bank", "asset");

  // Invoice: net €1,000 + 19% VAT = €1,190 gross. One balanced 3-line entry.
  await client.write(LedgerHandlers.createTransaction, {
    date: "2026-02-01",
    description: "Rechnung 2026-001",
    reference: "INV-2026-001",
    lines: [
      { accountId: receivables, amount: 119000 }, // gross owed to us
      { accountId: revenue, amount: -100000 }, // net revenue → income
      { accountId: vat, amount: -19000 }, // VAT collected → liability
    ],
  });

  // Revenue is recognised at invoice time — it's on the P&L before any payment.
  const beforePayment = await client.query<{ income: number; netIncome: number }>(
    LedgerQueries.reportIncomeStatement,
    {},
  );

  // Payment arrives → Bank up, receivable cleared. Income does NOT change here.
  await client.write(LedgerHandlers.createTransaction, {
    date: "2026-02-20",
    description: "Zahlung Rechnung 2026-001",
    reference: "INV-2026-001",
    lines: [
      { accountId: bank, amount: 119000 },
      { accountId: receivables, amount: -119000 },
    ],
  });

  // The payment moved cash and cleared the receivable — it touched no income
  // account, so the recognised revenue is unchanged.
  const afterPayment = await client.query<{ income: number }>(
    LedgerQueries.reportIncomeStatement,
    {},
  );

  const balances = await client.query<BalancesReport>(LedgerQueries.reportBalances, {});
  const balanceOf = (id: string) => balances.accounts.find((a) => a.id === id)?.balance ?? 0;

  return {
    revenueBeforePayment: beforePayment.income, // 100000 — accrual, cash-independent
    revenueAfterPayment: afterPayment.income, // 100000 — payment doesn't double-count
    receivablesAfterPayment: balanceOf(receivables), // 0 — invoice settled
    bank: balanceOf(bank), // 119000 — gross cash received
    vatOwed: balanceOf(vat), // 19000 — liability to the tax office
    trialBalance: balances.trialBalance, // 0
  };
}
