// Ledger Banking — money on accounts, moved by balanced transactions.
//
// Banking is the simplest double-entry case: each bank account is an `asset`,
// and a transfer is ONE transaction that debits the receiving account (+) and
// credits the sending one (−). The two lines sum to 0 — that is what makes the
// entry "balanced". No balance is ever stored; it's a pure query over the
// postings (ledger:query:report:balances).
//
// This recipe's integration test runs `bankingFlow` below against the real
// dispatcher + DB.

// The bundle exports its qualified handler/query names — use them instead of
// hardcoding the wire strings.
import {
  type AccountType,
  LedgerHandlers,
  LedgerQueries,
} from "@cosmicdrift/kumiko-bundled-features/ledger";

// The minimal surface the flow needs from a host dispatcher. An app's client
// satisfies this; the integration test adapts the test stack to it.
export type LedgerClient = {
  write: <T>(type: string, payload: unknown) => Promise<T>;
  query: <T>(type: string, payload: unknown) => Promise<T>;
};

type BalancesReport = {
  accounts: Array<{ id: string; name: string; balance: number }>;
  trialBalance: number;
};

// Open an account in the tenant's chart of accounts → returns its id.
async function openAccount(client: LedgerClient, name: string, type: AccountType): Promise<string> {
  const { id } = await client.write<{ id: string }>(LedgerHandlers.createAccount, { name, type });
  return id;
}

// A transfer is one balanced transaction: debit the receiver (+amount), credit
// the sender (−amount). Amounts are signed integer minor units (cents).
async function transfer(
  client: LedgerClient,
  opts: { from: string; to: string; amount: number; description: string; date: string },
): Promise<void> {
  await client.write(LedgerHandlers.createTransaction, {
    date: opts.date,
    description: opts.description,
    lines: [
      { accountId: opts.to, amount: opts.amount },
      { accountId: opts.from, amount: -opts.amount },
    ],
  });
}

// Fund a checking account from equity, move €200 of it to savings, then read
// the closing balances back. Returns the balances + the trial balance (Σ of all
// raw postings — 0 on a consistent ledger).
export async function bankingFlow(client: LedgerClient) {
  const opening = await openAccount(client, "Anfangsbestand", "equity");
  const checking = await openAccount(client, "Girokonto", "asset");
  const savings = await openAccount(client, "Sparkonto", "asset");

  await transfer(client, {
    from: opening,
    to: checking,
    amount: 100000,
    description: "Anfangsbestand Girokonto",
    date: "2026-01-01",
  });

  await transfer(client, {
    from: checking,
    to: savings,
    amount: 20000,
    description: "Sparrate Januar",
    date: "2026-01-05",
  });

  const report = await client.query<BalancesReport>(LedgerQueries.reportBalances, {});
  const balanceOf = (id: string) => report.accounts.find((a) => a.id === id)?.balance ?? 0;

  return {
    checking: balanceOf(checking), // 80000 — €1,000 funded − €200 moved out
    savings: balanceOf(savings), // 20000 — €200 moved in
    trialBalance: report.trialBalance, // 0 — the books are consistent
  };
}
