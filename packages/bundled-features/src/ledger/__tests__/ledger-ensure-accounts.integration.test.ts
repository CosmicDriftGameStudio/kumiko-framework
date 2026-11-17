// Full-stack integration for ledger:write:ensure-accounts (idempotent chart setup).

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
import { LedgerHandlers, LedgerQueries } from "../web/constants.ts";

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

const THREE_ACCOUNTS = [
  { code: "1200", name: "Bank", type: "asset" },
  { code: "8400", name: "Mieterträge", type: "income" },
  { code: "4000", name: "Aufwand", type: "expense" },
];

type EnsureResult = { accounts: Record<string, string> };

async function ensure(accounts: readonly Record<string, unknown>[]): Promise<EnsureResult> {
  return stack.http.writeOk<EnsureResult>(LedgerHandlers.ensureAccounts, { accounts }, admin);
}

async function listAccounts(): Promise<Array<Record<string, unknown>>> {
  const res = await stack.http.queryOk<{ rows: Array<Record<string, unknown>> }>(
    LedgerQueries.accountList,
    {},
    admin,
  );
  return res.rows;
}

describe("ledger integration — ensure-accounts", () => {
  test("first call creates the accounts and returns an id per code", async () => {
    const result = await ensure(THREE_ACCOUNTS);
    expect(Object.keys(result.accounts).sort()).toEqual(["1200", "4000", "8400"]);
    expect(await listAccounts()).toHaveLength(3);
  });

  test("a second identical call returns the same ids and creates nothing", async () => {
    const first = await ensure(THREE_ACCOUNTS);
    const second = await ensure(THREE_ACCOUNTS);
    expect(second.accounts).toEqual(first.accounts);
    expect(await listAccounts()).toHaveLength(3);
  });

  test("a known code with a different type is a conflict and creates nothing", async () => {
    await ensure(THREE_ACCOUNTS);
    const err = await stack.http.writeErr(
      LedgerHandlers.ensureAccounts,
      {
        accounts: [
          { code: "9999", name: "Neu", type: "asset" },
          { code: "1200", name: "Bank", type: "liability" },
        ],
      },
      admin,
    );
    expect(err.httpStatus).toBe(409);
    expect(await listAccounts()).toHaveLength(3);
  });

  test("parallel calls with the same codes create each account once and agree on the ids", async () => {
    const [a, b] = await Promise.all([ensure(THREE_ACCOUNTS), ensure(THREE_ACCOUNTS)]);
    expect(a.accounts).toEqual(b.accounts);
    expect(await listAccounts()).toHaveLength(3);
  });

  test("duplicate codes in one payload are rejected", async () => {
    const err = await stack.http.writeErr(
      LedgerHandlers.ensureAccounts,
      {
        accounts: [
          { code: "1200", name: "Bank", type: "asset" },
          { code: "1200", name: "Bank 2", type: "asset" },
        ],
      },
      admin,
    );
    expect(err.httpStatus).toBe(400);
    expect(await listAccounts()).toHaveLength(0);
  });
});
