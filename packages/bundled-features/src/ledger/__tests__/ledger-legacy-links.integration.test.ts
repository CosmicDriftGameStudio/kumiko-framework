// Transactions written before the system links moved into their own columns
// (eventVersion 1: Storno = reference holds the reversed id, schedule period =
// reference "schedule:<id>:<period>") must read as linked after a rebuild.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createRegistry } from "@cosmicdrift/kumiko-framework/engine";
import { append, eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createProjectionStateTable,
  rebuildProjection,
} from "@cosmicdrift/kumiko-framework/pipeline";
import { createTestUser } from "@cosmicdrift/kumiko-framework/seeding";
import { generateId } from "@cosmicdrift/kumiko-framework/utils";
import { resetTestTables } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { accountEntity, scheduleEntity, transactionEntity } from "../entity.ts";
import { createLedgerFeature } from "../feature.ts";
import { LedgerHandlers, LedgerQueries } from "../web/constants.ts";

const ledgerFeature = createLedgerFeature();
const TRANSACTION_PROJECTION = "ledger:projection:transaction-entity";

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({ features: [ledgerFeature] });
  await unsafeCreateEntityTable(stack.db, accountEntity);
  await unsafeCreateEntityTable(stack.db, transactionEntity);
  await unsafeCreateEntityTable(stack.db, scheduleEntity);
  await createProjectionStateTable(stack.db);
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

// Payload as the v1 entity wrote it: flat row, no system-link columns.
async function appendLegacyTransaction(row: {
  readonly id: string;
  readonly reference: string | null;
  readonly lines: readonly { accountId: string; amount: number }[];
  readonly description: string;
}): Promise<void> {
  await append(stack.db, {
    aggregateId: row.id,
    aggregateType: "transaction",
    tenantId: admin.tenantId,
    expectedVersion: 0,
    type: "transaction.created",
    eventVersion: 1,
    payload: {
      date: "2026-01-15",
      description: row.description,
      reference: row.reference,
      status: "posted",
      lines: row.lines,
    },
    metadata: { userId: admin.id, requestId: `legacy:${row.id}` },
  });
}

async function rebuildTransactions(): Promise<void> {
  await rebuildProjection(TRANSACTION_PROJECTION, {
    db: stack.db,
    registry: createRegistry([ledgerFeature]),
  });
}

async function listTransactions(): Promise<Array<Record<string, unknown>>> {
  const res = await stack.http.queryOk<{ rows: Array<Record<string, unknown>> }>(
    LedgerQueries.transactionList,
    {},
    admin,
  );
  return res.rows;
}

async function createAccount(name: string, type: "asset" | "income"): Promise<string> {
  const acc = await stack.http.writeOk<{ id: string }>(
    LedgerHandlers.createAccount,
    { name, type },
    admin,
  );
  return acc.id;
}

describe("ledger legacy events (eventVersion 1) after a rebuild", () => {
  test("an old Storno links to its original and the original cannot be reversed again", async () => {
    const bank = await createAccount("Bank", "asset");
    const rent = await createAccount("Mieterträge", "income");
    const lines = [
      { accountId: bank, amount: 1000 },
      { accountId: rent, amount: -1000 },
    ];
    const originalId = generateId();
    const stornoId = generateId();
    await appendLegacyTransaction({ id: originalId, reference: null, lines, description: "Miete" });
    await appendLegacyTransaction({
      id: stornoId,
      reference: originalId,
      lines: lines.map((l) => ({ ...l, amount: -l.amount })),
      description: "Storno: Miete",
    });

    await rebuildTransactions();

    const rows = await listTransactions();
    expect(rows.find((r) => r["id"] === stornoId)?.["reversesTransactionId"]).toBe(originalId);
    expect(rows.find((r) => r["id"] === originalId)?.["reversesTransactionId"] ?? null).toBeNull();

    const again = await stack.http.writeErr(
      LedgerHandlers.reverseTransaction,
      { id: originalId },
      admin,
    );
    expect(again.httpStatus).toBe(409);

    const reverseStorno = await stack.http.writeErr(
      LedgerHandlers.reverseTransaction,
      { id: stornoId },
      admin,
    );
    expect(reverseStorno.httpStatus).toBe(422);
  });

  test("an old booked schedule period is not booked again", async () => {
    const bank = await createAccount("Bank", "asset");
    const rent = await createAccount("Mieterträge", "income");
    const schedule = await stack.http.writeOk<{ id: string }>(
      LedgerHandlers.createSchedule,
      {
        description: "Miete",
        startDate: "2026-01-01",
        interval: "monthly",
        amount: 1000,
        debitAccountId: bank,
        creditAccountId: rent,
      },
      admin,
    );
    const bookedId = generateId();
    await appendLegacyTransaction({
      id: bookedId,
      reference: `schedule:${schedule.id}:2026-01`,
      lines: [
        { accountId: bank, amount: 1000 },
        { accountId: rent, amount: -1000 },
      ],
      description: "Miete",
    });

    await rebuildTransactions();

    const row = (await listTransactions()).find((r) => r["id"] === bookedId);
    expect(row?.["scheduleId"]).toBe(schedule.id);
    expect(row?.["period"]).toBe("2026-01");

    const confirmed = await stack.http.writeOk<{ id: string; alreadyBooked: boolean }>(
      LedgerHandlers.confirmSchedulePeriod,
      { scheduleId: schedule.id, period: "2026-01" },
      admin,
    );
    expect(confirmed).toEqual({ id: bookedId, alreadyBooked: true });
    expect(await listTransactions()).toHaveLength(1);
  });

  test("an old Storno of a schedule period copies scheduleId and period, so the period is re-confirmable", async () => {
    const bank = await createAccount("Bank", "asset");
    const rent = await createAccount("Mieterträge", "income");
    const schedule = await stack.http.writeOk<{ id: string }>(
      LedgerHandlers.createSchedule,
      {
        description: "Miete",
        startDate: "2026-01-01",
        interval: "monthly",
        amount: 1000,
        debitAccountId: bank,
        creditAccountId: rent,
      },
      admin,
    );
    const lines = [
      { accountId: bank, amount: 1000 },
      { accountId: rent, amount: -1000 },
    ];
    const bookedId = generateId();
    const stornoId = generateId();
    await appendLegacyTransaction({
      id: bookedId,
      reference: `schedule:${schedule.id}:2026-01`,
      lines,
      description: "Miete",
    });
    await appendLegacyTransaction({
      id: stornoId,
      reference: bookedId,
      lines: lines.map((l) => ({ ...l, amount: -l.amount })),
      description: "Storno: Miete",
    });

    await rebuildTransactions();

    const storno = (await listTransactions()).find((r) => r["id"] === stornoId);
    expect(storno?.["reversesTransactionId"]).toBe(bookedId);
    expect(storno?.["scheduleId"]).toBe(schedule.id);
    expect(storno?.["period"]).toBe("2026-01");

    const reconfirmed = await stack.http.writeOk<{ id: string; alreadyBooked: boolean }>(
      LedgerHandlers.confirmSchedulePeriod,
      { scheduleId: schedule.id, period: "2026-01" },
      admin,
    );
    expect(reconfirmed.alreadyBooked).toBe(false);
  });

  test("a v1 reference that names no transaction stays display text", async () => {
    const bank = await createAccount("Bank", "asset");
    const rent = await createAccount("Mieterträge", "income");
    const id = generateId();
    await appendLegacyTransaction({
      id,
      reference: "RE-2026-001",
      lines: [
        { accountId: bank, amount: 500 },
        { accountId: rent, amount: -500 },
      ],
      description: "Rechnung",
    });

    await rebuildTransactions();

    const row = (await listTransactions()).find((r) => r["id"] === id);
    expect(row?.["reference"]).toBe("RE-2026-001");
    expect(row?.["reversesTransactionId"] ?? null).toBeNull();
    expect(row?.["scheduleId"] ?? null).toBeNull();
  });
});
