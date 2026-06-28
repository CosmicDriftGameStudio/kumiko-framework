// Ledger Banking — integration test.
//
// Proves the documented bankingFlow end-to-end via the real dispatcher + DB:
// two asset accounts funded from equity, one transfer between them, and the
// balances read back as a pure query. The trial balance stays 0 — the golden
// double-entry invariant.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  accountEntity,
  createLedgerFeature,
  transactionEntity,
} from "@cosmicdrift/kumiko-bundled-features/ledger";
import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { bankingFlow, type LedgerClient } from "../usage";

const admin = createTestUser({ roles: ["TenantAdmin"] });
const ledger = createLedgerFeature();

let stack: TestStack;

// Adapt the test stack to the host-facing LedgerClient the docs embed uses.
const client: LedgerClient = {
  write: <T>(type: string, payload: unknown) => stack.http.writeOk<T>(type, payload, admin),
  query: <T>(type: string, payload: unknown) => stack.http.queryOk<T>(type, payload, admin),
};

beforeAll(async () => {
  stack = await setupTestStack({ features: [ledger] });
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

describe("ledger-banking recipe — transfer + derived balance", () => {
  test("the documented bankingFlow funds, transfers, and reads balances back", async () => {
    const result = await bankingFlow(client);

    expect(result.checking).toBe(80000);
    expect(result.savings).toBe(20000);
    // A transfer never destroys value — the books stay consistent.
    expect(result.trialBalance).toBe(0);
  });
});
