// Full-stack integration for the ledger bundle. Drives account + transaction
// through the real dispatcher + entity-projection + DB. Proves the double-entry
// primitive end-to-end:
//   - create-transaction books a balanced entry; the embedded lines round-trip
//   - an unbalanced entry (Σ ≠ 0) is rejected at the command boundary (400)
//   - a posting to a non-existent account is rejected (404, referential integrity)
//   - reverse-transaction books the negated mirror referencing the original
//   - the TRIAL BALANCE (Σ of every posting amount) is 0 — the invariant that
//     always holds, unlike the balance-sheet equation (which needs period close)
//   - multi-tenant isolation: each tenant has its own books

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { type AccountType, LedgerHandlers, LedgerQueries } from "../constants";
import { accountEntity, transactionEntity } from "../entity";
import { createLedgerFeature } from "../feature";
import type { Posting } from "../schemas";

const ledgerFeature = createLedgerFeature();

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({ features: [ledgerFeature] });
  await unsafeCreateEntityTable(stack.db, accountEntity);
  await unsafeCreateEntityTable(stack.db, transactionEntity);
  await createEventsTable(stack.db);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await asRawClient(stack.db).unsafe("DELETE FROM kumiko_events");
  await asRawClient(stack.db).unsafe("DELETE FROM read_ledger_accounts");
  await asRawClient(stack.db).unsafe("DELETE FROM read_ledger_transactions");
});

const admin = createTestUser({ roles: ["TenantAdmin"] });
const otherTenant = createTestUser({
  roles: ["TenantAdmin"],
  tenantId: "00000000-0000-4000-8000-0000000000aa",
});

async function createAccount(name: string, type: AccountType, user = admin): Promise<string> {
  const acc = await stack.http.writeOk<{ id: string }>(
    LedgerHandlers.createAccount,
    { name, type },
    user,
  );
  return acc.id;
}

async function createTransaction(
  lines: readonly Posting[],
  opts: { date?: string; description?: string } = {},
  user = admin,
): Promise<{ id: string }> {
  return stack.http.writeOk<{ id: string }>(
    LedgerHandlers.createTransaction,
    {
      date: opts.date ?? "2026-01-15",
      description: opts.description ?? "Test entry",
      lines,
    },
    user,
  );
}

async function listTransactions(user = admin): Promise<Array<Record<string, unknown>>> {
  const res = await stack.http.queryOk<{ rows: Array<Record<string, unknown>> }>(
    LedgerQueries.transactionList,
    {},
    user,
  );
  return res.rows;
}

// jsonb may surface as a parsed array or a string depending on the driver path —
// normalise so the assertions don't depend on it.
function linesOf(row: Record<string, unknown>): Posting[] {
  const raw = row["lines"];
  return (typeof raw === "string" ? JSON.parse(raw) : raw) as Posting[]; // @cast-boundary db-row
}

// The golden double-entry invariant: every entry sums to 0, so the sum over ALL
// postings of ALL transactions is 0.
function trialBalance(rows: Array<Record<string, unknown>>): number {
  return rows.reduce((s, r) => s + linesOf(r).reduce((t, l) => t + l.amount, 0), 0);
}

describe("ledger integration — create-transaction (balance invariant)", () => {
  test("books a balanced entry; lines round-trip; status posted", async () => {
    const bank = await createAccount("Bank", "asset");
    const rent = await createAccount("Mieterträge", "income");

    const tx = await createTransaction(
      [
        { accountId: bank, amount: 100000 },
        { accountId: rent, amount: -100000 },
      ],
      { description: "Miete Januar" },
    );

    const rows = await listTransactions();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.["id"]).toBe(tx.id);
    expect(rows[0]?.["status"]).toBe("posted");
    expect(rows[0]?.["description"]).toBe("Miete Januar");
    expect(linesOf(rows[0] as Record<string, unknown>)).toHaveLength(2);
  });

  test("rejects an unbalanced entry (Σ ≠ 0) — no transaction written", async () => {
    const bank = await createAccount("Bank", "asset");
    const rent = await createAccount("Mieterträge", "income");

    const err = await stack.http.writeErr(
      LedgerHandlers.createTransaction,
      {
        date: "2026-01-15",
        description: "schief",
        lines: [
          { accountId: bank, amount: 100000 },
          { accountId: rent, amount: -90000 },
        ],
      },
      admin,
    );
    expect(err.httpStatus).toBe(400);
    expect(await listTransactions()).toHaveLength(0);
  });

  test("rejects a posting to a non-existent account (404) — referential integrity", async () => {
    const bank = await createAccount("Bank", "asset");

    const err = await stack.http.writeErr(
      LedgerHandlers.createTransaction,
      {
        date: "2026-01-15",
        description: "ghost",
        lines: [
          { accountId: bank, amount: 100000 },
          { accountId: "00000000-0000-4000-8000-00000000dead", amount: -100000 },
        ],
      },
      admin,
    );
    expect(err.httpStatus).toBe(404);
    expect(await listTransactions()).toHaveLength(0);
  });
});

describe("ledger integration — reverse-transaction (Storno)", () => {
  test("books the negated mirror referencing the original; both remain", async () => {
    const bank = await createAccount("Bank", "asset");
    const rent = await createAccount("Mieterträge", "income");

    const tx = await createTransaction(
      [
        { accountId: bank, amount: 100000 },
        { accountId: rent, amount: -100000 },
      ],
      { description: "Miete" },
    );

    await stack.http.writeOk(LedgerHandlers.reverseTransaction, { id: tx.id }, admin);

    const rows = await listTransactions();
    expect(rows).toHaveLength(2);

    const storno = rows.find((r) => r["reference"] === tx.id);
    expect(storno).toBeDefined();
    const stornoLines = linesOf(storno as Record<string, unknown>);
    expect(stornoLines.find((l) => l.accountId === bank)?.amount).toBe(-100000);
    expect(stornoLines.find((l) => l.accountId === rent)?.amount).toBe(100000);

    // Original + Storno cancel → books net to zero.
    expect(trialBalance(rows)).toBe(0);
  });
});

describe("ledger integration — trial balance (golden invariant)", () => {
  test("Σ of every posting across all entries is 0", async () => {
    const bank = await createAccount("Bank", "asset");
    const rent = await createAccount("Mieterträge", "income");
    const expense = await createAccount("Aufwand", "expense");

    await createTransaction([
      { accountId: bank, amount: 100000 },
      { accountId: rent, amount: -100000 },
    ]);
    // Credit rate split: Zins (expense) + Tilgung … here just expense vs bank.
    await createTransaction([
      { accountId: expense, amount: 30000 },
      { accountId: bank, amount: -30000 },
    ]);

    expect(trialBalance(await listTransactions())).toBe(0);
  });
});

describe("ledger integration — multi-tenant isolation", () => {
  test("tenant B sees neither tenant A's accounts nor transactions", async () => {
    const bank = await createAccount("Bank", "asset", admin);
    const rent = await createAccount("Mieterträge", "income", admin);
    await createTransaction(
      [
        { accountId: bank, amount: 100000 },
        { accountId: rent, amount: -100000 },
      ],
      {},
      admin,
    );

    expect(await listTransactions(otherTenant)).toHaveLength(0);
    const otherAccounts = await stack.http.queryOk<{ rows: unknown[] }>(
      LedgerQueries.accountList,
      {},
      otherTenant,
    );
    expect(otherAccounts.rows).toHaveLength(0);

    expect(await listTransactions(admin)).toHaveLength(1);
  });
});

describe("ledger integration — reports (end-to-end)", () => {
  // Books: capital injection + rent income + an expense.
  async function seedBooks() {
    const bank = await createAccount("Bank", "asset");
    const equity = await createAccount("Eigenkapital", "equity");
    const rent = await createAccount("Mieterträge", "income");
    const expense = await createAccount("Aufwand", "expense");
    await createTransaction(
      [
        { accountId: bank, amount: 500000 },
        { accountId: equity, amount: -500000 },
      ],
      { date: "2026-01-01", description: "Kapital" },
    );
    await createTransaction(
      [
        { accountId: bank, amount: 100000 },
        { accountId: rent, amount: -100000 },
      ],
      { date: "2026-01-15", description: "Miete" },
    );
    await createTransaction(
      [
        { accountId: expense, amount: 30000 },
        { accountId: bank, amount: -30000 },
      ],
      { date: "2026-01-20", description: "Aufwand" },
    );
    return { bank };
  }

  test("balances report: natural balances + trial balance 0", async () => {
    const { bank } = await seedBooks();
    const r = await stack.http.queryOk<{
      accounts: Array<{ id: string; balance: number }>;
      trialBalance: number;
    }>(LedgerQueries.reportBalances, {}, admin);
    expect(r.trialBalance).toBe(0);
    expect(r.accounts.find((a) => a.id === bank)?.balance).toBe(570000);
  });

  test("income statement: income − expense = net income", async () => {
    await seedBooks();
    const r = await stack.http.queryOk<{
      income: number;
      expense: number;
      netIncome: number;
    }>(LedgerQueries.reportIncomeStatement, {}, admin);
    expect(r).toEqual({ income: 100000, expense: 30000, netIncome: 70000 });
  });

  test("balance sheet balances with the current result in equity", async () => {
    await seedBooks();
    const r = await stack.http.queryOk<{
      assets: number;
      liabilities: number;
      equity: number;
      currentResult: number;
      balances: boolean;
    }>(LedgerQueries.reportBalanceSheet, {}, admin);
    expect(r.assets).toBe(570000);
    expect(r.currentResult).toBe(70000);
    expect(r.equity).toBe(570000);
    expect(r.balances).toBe(true);
  });
});
