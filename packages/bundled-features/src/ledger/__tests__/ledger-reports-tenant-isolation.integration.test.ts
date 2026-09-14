// Regression for fw#2858: reports.query.ts's loadBooks() reads accounts and
// transactions via a raw DbRunner with an explicit `tenantId` where-clause.
// If that filter is ever dropped (e.g. a future refactor swaps back to an
// unfiltered runner), a tenant's report would silently aggregate every other
// tenant's books. Two tenants book distinct, non-cancelling amounts so a
// cross-tenant leak changes the report totals, not just adds zero-sum noise.

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
import { accountEntity, scheduleEntity, transactionEntity } from "../entity";
import { createLedgerFeature } from "../feature";
import type { Posting } from "../schemas";

const ledgerFeature = createLedgerFeature();

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({ features: [ledgerFeature] });
  await unsafeCreateEntityTable(stack.db, accountEntity);
  await unsafeCreateEntityTable(stack.db, transactionEntity);
  await unsafeCreateEntityTable(stack.db, scheduleEntity);
  await createEventsTable(stack.db);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await asRawClient(stack.db).unsafe("DELETE FROM kumiko_events");
  await asRawClient(stack.db).unsafe("DELETE FROM read_ledger_accounts");
  await asRawClient(stack.db).unsafe("DELETE FROM read_ledger_transactions");
  await asRawClient(stack.db).unsafe("DELETE FROM read_ledger_schedules");
});

const tenantA = createTestUser({ roles: ["TenantAdmin"] });
const tenantB = createTestUser({
  roles: ["TenantAdmin"],
  tenantId: "00000000-0000-4000-8000-0000000000bb",
});

async function createAccount(
  name: string,
  type: AccountType,
  user: typeof tenantA,
): Promise<string> {
  const acc = await stack.http.writeOk<{ id: string }>(
    LedgerHandlers.createAccount,
    { name, type },
    user,
  );
  return acc.id;
}

async function createTransaction(
  lines: readonly Posting[],
  opts: { date?: string; description?: string },
  user: typeof tenantA,
): Promise<void> {
  await stack.http.writeOk(
    LedgerHandlers.createTransaction,
    { date: opts.date ?? "2026-01-15", description: opts.description ?? "Entry", lines },
    user,
  );
}

async function seedBooks(user: typeof tenantA, capital: number, income: number, expense: number) {
  const bank = await createAccount("Bank", "asset", user);
  const equity = await createAccount("Equity", "equity", user);
  const rent = await createAccount("Rent", "income", user);
  const cost = await createAccount("Cost", "expense", user);
  await createTransaction(
    [
      { accountId: bank, amount: capital },
      { accountId: equity, amount: -capital },
    ],
    { date: "2026-01-01", description: "Capital" },
    user,
  );
  await createTransaction(
    [
      { accountId: bank, amount: income },
      { accountId: rent, amount: -income },
    ],
    { date: "2026-01-10", description: "Income" },
    user,
  );
  await createTransaction(
    [
      { accountId: cost, amount: expense },
      { accountId: bank, amount: -expense },
    ],
    { date: "2026-01-20", description: "Expense" },
    user,
  );
  return { bank };
}

describe("ledger integration — report tenant isolation", () => {
  test("reportBalances excludes the other tenant's accounts and amounts", async () => {
    const { bank: bankA } = await seedBooks(tenantA, 500000, 100000, 30000);
    const { bank: bankB } = await seedBooks(tenantB, 200000, 50000, 10000);

    const reportA = await stack.http.queryOk<{
      accounts: Array<{ id: string; balance: number }>;
      trialBalance: number;
    }>(LedgerQueries.reportBalances, {}, tenantA);
    expect(reportA.accounts).toHaveLength(4);
    expect(reportA.accounts.some((a) => a.id === bankB)).toBe(false);
    expect(reportA.accounts.find((a) => a.id === bankA)?.balance).toBe(570000);

    const reportB = await stack.http.queryOk<{
      accounts: Array<{ id: string; balance: number }>;
      trialBalance: number;
    }>(LedgerQueries.reportBalances, {}, tenantB);
    expect(reportB.accounts).toHaveLength(4);
    expect(reportB.accounts.some((a) => a.id === bankA)).toBe(false);
    expect(reportB.accounts.find((a) => a.id === bankB)?.balance).toBe(240000);
  });

  test("reportIncomeStatement does not sum the other tenant's income/expense", async () => {
    await seedBooks(tenantA, 500000, 100000, 30000);
    await seedBooks(tenantB, 200000, 50000, 10000);

    const stmtA = await stack.http.queryOk<{
      income: number;
      expense: number;
      netIncome: number;
    }>(LedgerQueries.reportIncomeStatement, {}, tenantA);
    expect(stmtA).toEqual({ income: 100000, expense: 30000, netIncome: 70000 });

    const stmtB = await stack.http.queryOk<{
      income: number;
      expense: number;
      netIncome: number;
    }>(LedgerQueries.reportIncomeStatement, {}, tenantB);
    expect(stmtB).toEqual({ income: 50000, expense: 10000, netIncome: 40000 });
  });
});
