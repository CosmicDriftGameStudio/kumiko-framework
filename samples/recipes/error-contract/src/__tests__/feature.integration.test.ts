// Error-Contract Sample — integration test
//
// Proves every pattern in feature.ts makes it through the real stack with the
// documented wire shape. If you extend the sample, add a matching test here
// so the "copy this" guarantee stays valid.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { buildEntityTable } from "@cosmicdrift/kumiko-framework/db";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  TestUsers,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { OrdersLiteReasons, orderEntity, ordersLiteFeature } from "../feature";
import { asRawClient, updateMany } from "@cosmicdrift/kumiko-framework/bun-db";

let stack: TestStack;
const orderTable = buildEntityTable("order", orderEntity);

const admin = TestUsers.admin;
const alice = createTestUser({ id: 10, roles: ["User"] });
const bob = createTestUser({ id: 11, roles: ["User"] });

beforeAll(async () => {
  stack = await setupTestStack({ features: [ordersLiteFeature], systemHooks: [] });
  await unsafeCreateEntityTable(stack.db, orderEntity);
  await createEventsTable(stack.db);
});
afterAll(async () => stack.cleanup());
beforeEach(async () => {
  await asRawClient(stack.db).unsafe(`DELETE FROM "${orderTable.tableName}"`);
});

// --- 1) Zod validation error via schema: empty cart rejected ---

describe("Zod validation → ValidationError", () => {
  test("totalCents < 1 rejects with validation_error + details.fields", async () => {
    const error = await stack.http.writeErr(
      "orders-lite:write:order:create",
      { totalCents: 0 },
      alice,
    );
    expect(error.code).toBe("validation_error");
    const fields = (error.details as { fields: Array<{ path: string; code: string }> }).fields;
    expect(fields).toContainEqual(expect.objectContaining({ path: "totalCents" }));
  });
});

// --- 2) NotFoundError from failNotFound helper ---

describe("failNotFound → NotFoundError", () => {
  test("pay on missing order → 404, reason = order_not_found", async () => {
    const error = await stack.http.writeErr(
      "orders-lite:write:order:pay",
      { id: "00000000-0000-4000-8000-000000000999" },
      alice,
    );
    expect(error.code).toBe("not_found");
    expect(error.httpStatus).toBe(404);
    expect(error.details).toMatchObject({ reason: "order_not_found", entity: "order" });
  });
});

// --- 3) AccessDeniedError for ownership mismatch ---

describe("writeFailure(AccessDeniedError) → 403", () => {
  test("Bob cannot pay Alice's order", async () => {
    const alicesOrder = await stack.http.writeOk<{ id: number }>(
      "orders-lite:write:order:create",
      { totalCents: 100 },
      alice,
    );
    const error = await stack.http.writeErr(
      "orders-lite:write:order:pay",
      { id: alicesOrder.id },
      bob,
    );
    expect(error.code).toBe("access_denied");
    expect(error.httpStatus).toBe(403);
    expect(error.details).toMatchObject({ reason: "not_yours", orderId: alicesOrder.id });
  });
});

// --- 4) UnprocessableError with feature reason ---

describe("failUnprocessable(OrdersLiteReasons.X) → 422", () => {
  test("cancelling an already-cancelled order fails with reason=already_cancelled", async () => {
    const order = await stack.http.writeOk<{ id: number }>(
      "orders-lite:write:order:create",
      { totalCents: 100 },
      alice,
    );
    await stack.http.writeOk("orders-lite:write:order:cancel", { id: order.id }, alice);

    const error = await stack.http.writeErr(
      "orders-lite:write:order:cancel",
      { id: order.id },
      alice,
    );
    expect(error.code).toBe("unprocessable");
    expect(error.httpStatus).toBe(422);
    expect(error.details).toMatchObject({ reason: OrdersLiteReasons.alreadyCancelled });
  });
});

// --- 5) ConflictError for a domain conflict ---

describe("ConflictError → 409", () => {
  test("cancelling a paid order is a refund-required conflict", async () => {
    const order = await stack.http.writeOk<{ id: number }>(
      "orders-lite:write:order:create",
      { totalCents: 100 },
      alice,
    );
    // Force the row into `paid` via direct DB update. The sample feature
    // doesn't expose a "place" action, so we can't walk the state machine —
    // the point of this test is ConflictError semantics, not the transition
    // path itself.
    await updateMany(stack.db, orderTable, { status: "paid" }, { id: order.id });

    const error = await stack.http.writeErr(
      "orders-lite:write:order:cancel",
      { id: order.id },
      alice,
    );
    expect(error.code).toBe("conflict");
    expect(error.httpStatus).toBe(409);
    expect(error.details).toMatchObject({ reason: "refund_required" });
  });
});

// --- 6) guardTransition → UnprocessableError with FrameworkReasons ---

describe("guardTransition → FrameworkReasons.invalidTransition", () => {
  test("paying a cancelled order is an invalid transition", async () => {
    const order = await stack.http.writeOk<{ id: number }>(
      "orders-lite:write:order:create",
      { totalCents: 100 },
      admin,
    );
    await stack.http.writeOk("orders-lite:write:order:cancel", { id: order.id }, admin);

    const error = await stack.http.writeErr("orders-lite:write:order:pay", { id: order.id }, admin);
    expect(error.code).toBe("unprocessable");
    expect(error.details).toMatchObject({
      reason: "invalid_transition",
      from: "cancelled",
      to: "paid",
    });
  });
});

// --- 7) Throw-based KumikoError (not via writeFailure) ---

describe("direct throw of KumikoError", () => {
  test("thrown NotFoundError round-trips to the same wire format", async () => {
    const error = await stack.http.writeErr(
      "orders-lite:write:order:rename",
      { id: "00000000-0000-4000-8000-000000000999", nickname: "Anything" },
      alice,
    );
    expect(error.code).toBe("not_found");
    expect(error.details).toMatchObject({ entity: "order" });
  });

  test("thrown UnprocessableError with literal reason", async () => {
    const order = await stack.http.writeOk<{ id: number }>(
      "orders-lite:write:order:create",
      { totalCents: 100 },
      alice,
    );
    const error = await stack.http.writeErr(
      "orders-lite:write:order:rename",
      { id: order.id, nickname: "banned" },
      alice,
    );
    expect(error.code).toBe("unprocessable");
    expect(error.details).toMatchObject({ reason: "nickname_not_allowed" });
  });
});
