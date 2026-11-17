// Full-stack integration for the ledger totals queries: report:subject-totals
// (per-subject saldo in one call) and schedule-actuals (forecast vs. actual feed).

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { createTestUser } from "@cosmicdrift/kumiko-framework/seeding";
import { resetTestTables } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { accountEntity, scheduleEntity, transactionEntity } from "../entity.ts";
import { createLedgerFeature } from "../feature.ts";
import { type LedgerTxRow, mergeScheduleActuals, projectSchedule } from "../recurring.ts";
import type { Posting } from "../schemas.ts";
import { type AccountType, LedgerHandlers, LedgerQueries } from "../web/constants.ts";

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({ features: [createLedgerFeature()] });
  await unsafeCreateEntityTable(stack.db, accountEntity);
  await unsafeCreateEntityTable(stack.db, transactionEntity);
  await unsafeCreateEntityTable(stack.db, scheduleEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await resetTestTables(stack.db, [
    eventsTable,
    "read_ledger_accounts",
    "read_ledger_transactions",
    "read_ledger_schedules",
  ]);
});

const admin = createTestUser({ roles: ["TenantAdmin"] });
const otherTenant = createTestUser({
  roles: ["TenantAdmin"],
  tenantId: "00000000-0000-4000-8000-0000000000aa",
});

type TotalRow = { subjectId: string; period: string | null; accountId: string; amount: number };

async function createAccount(name: string, type: AccountType, user = admin): Promise<string> {
  const acc = await stack.http.writeOk<{ id: string }>(
    LedgerHandlers.createAccount,
    { name, type },
    user,
  );
  return acc.id;
}

async function book(
  lines: readonly Posting[],
  opts: {
    subjectType?: string;
    subjectId?: string;
    period?: string;
    date?: string;
    status?: "draft" | "posted";
  } = {},
  user = admin,
): Promise<string> {
  const tx = await stack.http.writeOk<{ id: string }>(
    LedgerHandlers.createTransaction,
    {
      date: opts.date ?? "2026-01-15",
      description: "Test entry",
      lines,
      ...(opts.subjectType !== undefined && { subjectType: opts.subjectType }),
      ...(opts.subjectId !== undefined && { subjectId: opts.subjectId }),
      ...(opts.period !== undefined && { period: opts.period }),
      ...(opts.status !== undefined && { status: opts.status }),
    },
    user,
  );
  return tx.id;
}

async function totals(query: Record<string, unknown>, user = admin): Promise<TotalRow[]> {
  const res = await stack.http.queryOk<{ rows: TotalRow[] }>(
    LedgerQueries.reportSubjectTotals,
    { subjectType: "lease", ...query },
    user,
  );
  return res.rows;
}

describe("ledger integration — report:subject-totals", () => {
  async function seedTwoLeases(): Promise<{ bank: string; rent: string }> {
    const bank = await createAccount("Bank", "asset");
    const rent = await createAccount("Mieterträge", "income");
    const entry = (amount: number): Posting[] => [
      { accountId: bank, amount },
      { accountId: rent, amount: -amount },
    ];
    await book(entry(1000), { subjectType: "lease", subjectId: "l1", period: "2026-01" });
    await book(entry(1000), {
      subjectType: "lease",
      subjectId: "l1",
      period: "2026-02",
      date: "2026-02-01",
    });
    await book(entry(500), { subjectType: "lease", subjectId: "l2", period: "2026-01" });
    return { bank, rent };
  }

  test("sums per subject and account; byPeriod splits by period", async () => {
    const { bank, rent } = await seedTwoLeases();

    const merged = await totals({ subjectIds: ["l1", "l2"] });
    expect(merged).toEqual([
      { subjectId: "l1", period: null, accountId: bank, amount: 2000 },
      { subjectId: "l1", period: null, accountId: rent, amount: -2000 },
      { subjectId: "l2", period: null, accountId: bank, amount: 500 },
      { subjectId: "l2", period: null, accountId: rent, amount: -500 },
    ].sort((a, b) => a.subjectId.localeCompare(b.subjectId) || a.accountId.localeCompare(b.accountId)));

    const perPeriod = await totals({ subjectIds: ["l1"], byPeriod: true });
    expect(perPeriod.filter((r) => r.accountId === bank).map((r) => [r.period, r.amount])).toEqual([
      ["2026-01", 1000],
      ["2026-02", 1000],
    ]);
  });

  test("a Storno nets the sum to 0 and the entry is omitted", async () => {
    const bank = await createAccount("Bank", "asset");
    const rent = await createAccount("Mieterträge", "income");
    const id = await book(
      [
        { accountId: bank, amount: 800 },
        { accountId: rent, amount: -800 },
      ],
      { subjectType: "lease", subjectId: "l1", period: "2026-01" },
    );
    await stack.http.writeOk(LedgerHandlers.reverseTransaction, { id }, admin);

    expect(await totals({ subjectIds: ["l1"] })).toEqual([]);
    expect(await totals({ subjectIds: ["l1"], byPeriod: true })).toEqual([]);
  });

  test("asOf excludes later booking dates", async () => {
    const bank = await createAccount("Bank", "asset");
    const rent = await createAccount("Mieterträge", "income");
    const lines = (amount: number): Posting[] => [
      { accountId: bank, amount },
      { accountId: rent, amount: -amount },
    ];
    await book(lines(100), { subjectType: "lease", subjectId: "l1", date: "2026-01-10" });
    await book(lines(200), { subjectType: "lease", subjectId: "l1", date: "2026-03-10" });

    const rows = await totals({ subjectIds: ["l1"], asOf: "2026-02-01" });
    expect(rows.find((r) => r.accountId === bank)?.amount).toBe(100);
  });

  test("accountIds filters the lines", async () => {
    const { bank } = await seedTwoLeases();
    const rows = await totals({ subjectIds: ["l1", "l2"], accountIds: [bank] });
    expect(rows.every((r) => r.accountId === bank)).toBe(true);
    expect(rows.map((r) => [r.subjectId, r.amount])).toEqual([
      ["l1", 2000],
      ["l2", 500],
    ]);
  });

  test("periodFrom/periodTo exclude rows outside the range and rows without a period", async () => {
    const bank = await createAccount("Bank", "asset");
    const rent = await createAccount("Mieterträge", "income");
    const lines = (amount: number): Posting[] => [
      { accountId: bank, amount },
      { accountId: rent, amount: -amount },
    ];
    await book(lines(1), { subjectType: "lease", subjectId: "l1", period: "2026-01" });
    await book(lines(10), { subjectType: "lease", subjectId: "l1", period: "2026-02" });
    await book(lines(100), { subjectType: "lease", subjectId: "l1", period: "2026-03" });
    await book(lines(1000), { subjectType: "lease", subjectId: "l1" });

    const rows = await totals({ subjectIds: ["l1"], periodFrom: "2026-02", periodTo: "2026-03" });
    expect(rows.find((r) => r.accountId === bank)?.amount).toBe(110);

    const all = await totals({ subjectIds: ["l1"] });
    expect(all.find((r) => r.accountId === bank)?.amount).toBe(1111);
  });

  test("draft entries are not counted", async () => {
    const bank = await createAccount("Bank", "asset");
    const rent = await createAccount("Mieterträge", "income");
    await book(
      [
        { accountId: bank, amount: 300 },
        { accountId: rent, amount: -300 },
      ],
      { subjectType: "lease", subjectId: "l1", status: "draft" },
    );
    expect(await totals({ subjectIds: ["l1"] })).toEqual([]);
  });

  test("another tenant sees nothing of the same subject ids", async () => {
    await seedTwoLeases();
    expect(await totals({ subjectIds: ["l1", "l2"] }, otherTenant)).toEqual([]);
  });
});

describe("ledger integration — schedule-actuals", () => {
  async function createSchedule(debit: string, credit: string): Promise<string> {
    const s = await stack.http.writeOk<{ id: string }>(
      LedgerHandlers.createSchedule,
      {
        description: "Miete",
        startDate: "2026-01-01",
        interval: "monthly",
        amount: 50000,
        debitAccountId: debit,
        creditAccountId: credit,
      },
      admin,
    );
    return s.id;
  }

  async function confirm(scheduleId: string, period: string): Promise<string> {
    const r = await stack.http.writeOk<{ id: string }>(
      LedgerHandlers.confirmSchedulePeriod,
      { scheduleId, period },
      admin,
    );
    return r.id;
  }

  test("returns only the requested schedules' rows incl. Storno, and the merge shows the reversed period open", async () => {
    const bank = await createAccount("Bank", "asset");
    const rent = await createAccount("Mieterträge", "income");
    const s1 = await createSchedule(bank, rent);
    const s2 = await createSchedule(bank, rent);
    await confirm(s1, "2026-01");
    const feb = await confirm(s1, "2026-02");
    await confirm(s2, "2026-01");
    await stack.http.writeOk(LedgerHandlers.reverseTransaction, { id: feb }, admin);

    const res = await stack.http.queryOk<{ rows: LedgerTxRow[] }>(
      LedgerQueries.scheduleActuals,
      { scheduleIds: [s1] },
      admin,
    );
    expect(res.rows).toHaveLength(3);
    expect(res.rows.every((r) => r.scheduleId === s1)).toBe(true);
    expect(res.rows.filter((r) => r.reversesTransactionId !== null)).toHaveLength(1);

    const projection = projectSchedule(
      { startDate: "2026-01-01", interval: "monthly", amount: 50000 },
      { from: "2026-01", to: "2026-03" },
    );
    const months = mergeScheduleActuals(s1, projection, res.rows, "2026-03");
    expect(months.map((m) => [m.period, m.status])).toEqual([
      ["2026-01", "posted"],
      ["2026-02", "open"],
      ["2026-03", "open"],
    ]);
  });
});
