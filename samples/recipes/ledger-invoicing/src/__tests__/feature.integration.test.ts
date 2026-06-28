// Ledger Invoicing — integration test.
//
// Proves the documented invoicingFlow end-to-end via the real dispatcher + DB:
//   - issuing an invoice recognises revenue immediately (accrual), splits VAT
//     off as a liability, and raises a receivable for the gross amount
//   - the payment clears the receivable and brings in the cash — without
//     touching the P&L a second time
//   - the trial balance stays 0 throughout

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
import { invoicingFlow, type LedgerClient } from "../usage";

const admin = createTestUser({ roles: ["TenantAdmin"] });
const ledger = createLedgerFeature();

let stack: TestStack;

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

describe("ledger-invoicing recipe — accrual + receivable lifecycle", () => {
  test("the documented invoicingFlow recognises revenue at invoice time, clears AR on payment", async () => {
    const result = await invoicingFlow(client);

    // Revenue recognised when invoiced — before any cash moved.
    expect(result.revenueBeforePayment).toBe(100000);
    // Payment doesn't double-count income — revenue is still €1,000 afterwards.
    expect(result.revenueAfterPayment).toBe(100000);
    // Receivable settled once paid.
    expect(result.receivablesAfterPayment).toBe(0);
    // Gross cash in; VAT held as a liability owed to the tax office.
    expect(result.bank).toBe(119000);
    expect(result.vatOwed).toBe(19000);
    expect(result.trialBalance).toBe(0);
  });
});
