// State Machine Sample — Integration Test
// Proves: valid transitions work, invalid transitions rejected,
// state skipping rejected, role-based access, business logic in handler,
// non-linear transitions (reopen)
//
// Workflow:
//   draft → sent → paid
//                 → cancelled → draft (reopen)

import {
  createTestUser,
  setupTestStack,
  type TestStack,
  TestUsers,
} from "@cosmicdrift/kumiko-framework/stack";
import { expectErrorIncludes } from "@cosmicdrift/kumiko-framework/testing";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { stateMachineFeature } from "../feature";

let stack: TestStack;

const admin = TestUsers.admin;
const accounting = createTestUser({ id: 2, roles: ["Accounting"] });
const viewer = createTestUser({ id: 3, roles: ["Viewer"] });
const otherTenantAdmin = createTestUser({
  id: 4,
  tenantId: "00000000-0000-4000-8000-000000000002",
  roles: ["Admin"],
});

beforeAll(async () => {
  stack = await setupTestStack({
    features: [stateMachineFeature],
    systemHooks: [],
  });
  // The projection table (sample_sm_invoices) is auto-pushed by setupTestStack
  // because r.projection() declares it in feature.ts.
});

afterAll(async () => {
  await stack.cleanup();
});

// Helper: create a draft invoice. The writeOk return-shape carries the
// SaveContext envelope (`{ data: { id, data: { status, ... }, ... } }`)
// — typed here so individual call sites don't need to cast.
type InvoiceWriteResult = {
  id: string;
  data: { status: string };
};
async function createDraftInvoice(title = "Test Invoice"): Promise<InvoiceWriteResult> {
  return stack.http.writeOk<InvoiceWriteResult>(
    "billing:write:invoice:create",
    { title, amount: 100, amountCurrency: "EUR" },
    admin,
  );
}

// --- Happy path ---

describe("happy path: draft → sent → paid", () => {
  test("create starts in draft", async () => {
    const data = await createDraftInvoice();
    expect(data["data"]["status"]).toBe("draft");
  });

  test("send moves draft → sent", async () => {
    const created = await createDraftInvoice();
    const sent = await stack.http.writeOk<InvoiceWriteResult>(
      "billing:write:invoice:send",
      { id: created["id"] },
      admin,
    );
    expect(sent["data"]["status"]).toBe("sent");
  });

  test("markPaid moves sent → paid", async () => {
    const created = await createDraftInvoice();
    await stack.http.writeOk<InvoiceWriteResult>(
      "billing:write:invoice:send",
      { id: created["id"] },
      admin,
    );
    const paid = await stack.http.writeOk<InvoiceWriteResult>(
      "billing:write:invoice:mark-paid",
      { id: created["id"] },
      accounting,
    );
    expect(paid["data"]["status"]).toBe("paid");
  });
});

// --- Invalid transitions ---

describe("invalid transitions rejected", () => {
  test("cannot skip draft → paid (must go through sent)", async () => {
    const created = await createDraftInvoice();
    const error = await stack.http.writeErr(
      "billing:write:invoice:mark-paid",
      { id: created["id"] },
      accounting,
    );
    expectErrorIncludes(error, "Invalid transition");
  });

  test("cannot cancel from draft (only from sent)", async () => {
    const created = await createDraftInvoice();
    const error = await stack.http.writeErr(
      "billing:write:invoice:cancel",
      { id: created["id"] },
      admin,
    );
    expectErrorIncludes(error, "Invalid transition");
  });

  test("cannot send from paid (terminal state)", async () => {
    const created = await createDraftInvoice();
    await stack.http.writeOk<InvoiceWriteResult>(
      "billing:write:invoice:send",
      { id: created["id"] },
      admin,
    );
    await stack.http.writeOk<InvoiceWriteResult>(
      "billing:write:invoice:mark-paid",
      { id: created["id"] },
      accounting,
    );

    const error = await stack.http.writeErr(
      "billing:write:invoice:send",
      { id: created["id"] },
      admin,
    );
    expectErrorIncludes(error, "Invalid transition");
  });
});

// --- Non-linear: reopen ---

describe("non-linear transitions", () => {
  test("cancelled invoice can be reopened to draft", async () => {
    const created = await createDraftInvoice("Reopen Test");
    await stack.http.writeOk<InvoiceWriteResult>(
      "billing:write:invoice:send",
      { id: created["id"] },
      admin,
    );
    await stack.http.writeOk<InvoiceWriteResult>(
      "billing:write:invoice:cancel",
      { id: created["id"] },
      admin,
    );

    const reopened = await stack.http.writeOk<InvoiceWriteResult>(
      "billing:write:invoice:reopen",
      { id: created["id"] },
      admin,
    );
    expect(reopened["data"]["status"]).toBe("draft");
  });

  test("cannot reopen from sent (only from cancelled)", async () => {
    const created = await createDraftInvoice();
    await stack.http.writeOk<InvoiceWriteResult>(
      "billing:write:invoice:send",
      { id: created["id"] },
      admin,
    );

    const error = await stack.http.writeErr(
      "billing:write:invoice:reopen",
      { id: created["id"] },
      admin,
    );
    expectErrorIncludes(error, "Invalid transition");
  });
});

// --- Role-based access ---

describe("role-based access per transition", () => {
  test("Viewer cannot send invoice", async () => {
    const created = await createDraftInvoice();
    const error = await stack.http.writeErr(
      "billing:write:invoice:send",
      { id: created["id"] },
      viewer,
    );
    expect(error.code).toBe("access_denied");
  });

  test("Admin cannot markPaid (Accounting only)", async () => {
    const created = await createDraftInvoice();
    await stack.http.writeOk<InvoiceWriteResult>(
      "billing:write:invoice:send",
      { id: created["id"] },
      admin,
    );

    const error = await stack.http.writeErr(
      "billing:write:invoice:mark-paid",
      { id: created["id"] },
      admin,
    );
    expect(error.code).toBe("access_denied");
  });

  test("Accounting can markPaid", async () => {
    const created = await createDraftInvoice();
    await stack.http.writeOk<InvoiceWriteResult>(
      "billing:write:invoice:send",
      { id: created["id"] },
      admin,
    );

    const paid = await stack.http.writeOk<InvoiceWriteResult>(
      "billing:write:invoice:mark-paid",
      { id: created["id"] },
      accounting,
    );
    expect(paid["data"]["status"]).toBe("paid");
  });
});

// --- Tenant isolation ---

describe("tenant isolation", () => {
  test("other tenant cannot transition invoice", async () => {
    const created = await createDraftInvoice("Tenant1 Invoice");

    const error = await stack.http.writeErr(
      "billing:write:invoice:send",
      { id: created["id"] },
      otherTenantAdmin,
    );
    expect(error.code).toBe("not_found");
  });
});

// --- Business logic in handler ---

describe("business logic with transitions", () => {
  test("cannot markPaid if amount is 0", async () => {
    const created = await stack.http.writeOk<InvoiceWriteResult>(
      "billing:write:invoice:create",
      { title: "Zero Invoice", amount: 0, amountCurrency: "EUR" },
      admin,
    );
    await stack.http.writeOk<InvoiceWriteResult>(
      "billing:write:invoice:send",
      { id: created["id"] },
      admin,
    );

    const error = await stack.http.writeErr(
      "billing:write:invoice:mark-paid",
      { id: created["id"] },
      accounting,
    );
    expectErrorIncludes(error, "cannot_pay_zero_amount");
  });
});

// --- Auto transition guard (pipeline) ---

describe("auto transition guard from pipeline", () => {
  test("updateStatus with valid transition succeeds (no manual guard)", async () => {
    const created = await createDraftInvoice("Auto Guard OK");
    const updated = await stack.http.writeOk<InvoiceWriteResult>(
      "billing:write:invoice:update-status",
      { id: created["id"], changes: { status: "sent" }, version: 1 },
      admin,
    );
    expect(updated["data"]["status"]).toBe("sent");
  });

  test("updateStatus with invalid transition rejected by auto guard", async () => {
    const created = await createDraftInvoice("Auto Guard Fail");
    const error = await stack.http.writeErr(
      "billing:write:invoice:update-status",
      { id: created["id"], changes: { status: "paid" }, version: 1 },
      admin,
    );
    expectErrorIncludes(error, "Invalid transition");
  });
});

// --- skipTransitionGuard ---

describe("skipTransitionGuard", () => {
  test("forceStatus bypasses transition guard (draft → paid directly)", async () => {
    const created = await createDraftInvoice("Force Status");
    const forced = await stack.http.writeOk<InvoiceWriteResult>(
      "billing:write:invoice:force-status",
      { id: created["id"], status: "paid" },
      admin,
    );
    expect(forced["data"]["status"]).toBe("paid");
  });

  test("forceStatus can set any state from any state", async () => {
    const created = await createDraftInvoice("Force Any");
    // draft → paid (skip sent)
    await stack.http.writeOk<InvoiceWriteResult>(
      "billing:write:invoice:force-status",
      { id: created["id"], status: "paid" },
      admin,
    );
    // paid → draft (normally impossible)
    const back = await stack.http.writeOk<InvoiceWriteResult>(
      "billing:write:invoice:force-status",
      { id: created["id"], status: "draft" },
      admin,
    );
    expect(back["data"]["status"]).toBe("draft");
  });
});
