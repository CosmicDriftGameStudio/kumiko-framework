// Idempotency Sample — Integration Test
// Proves: duplicate requestId returns cached result, no double insert

import { createEventsTable } from "@kumiko/framework/event-store";
import {
  createEntityTable,
  createTestUser,
  setupTestStack,
  type TestStack,
} from "@kumiko/framework/stack";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { orderEntity, orderFeature } from "../feature";

let stack: TestStack;

const customer = createTestUser({ roles: ["Customer"] });

beforeAll(async () => {
  stack = await setupTestStack({ features: [orderFeature] });
  await createEntityTable(stack.db, orderEntity);
  await createEventsTable(stack.db);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(() => {
  stack.events.reset();
});

describe("idempotent writes", () => {
  test("same requestId returns cached result, no duplicate", async () => {
    const requestId = "order-idem-001";

    const first = await stack.http.writeOk(
      "orders:write:order:place",
      { customerName: "Alice", product: "Widget" },
      customer,
      requestId,
    );

    const second = await stack.http.writeOk(
      "orders:write:order:place",
      { customerName: "Alice", product: "Widget" },
      customer,
      requestId,
    );

    // Same ID = cached, not a new record
    expect(second.id).toBe(first.id);
  });

  test("different requestIds create separate records", async () => {
    const first = await stack.http.writeOk(
      "orders:write:order:place",
      { customerName: "Bob", product: "Gadget A" },
      customer,
      "order-a",
    );

    const second = await stack.http.writeOk(
      "orders:write:order:place",
      { customerName: "Bob", product: "Gadget B" },
      customer,
      "order-b",
    );

    expect(first.id).not.toBe(second.id);
  });

  test("no requestId = always creates new record", async () => {
    const first = await stack.http.writeOk(
      "orders:write:order:place",
      { customerName: "Carol", product: "Same" },
      customer,
    );

    const second = await stack.http.writeOk(
      "orders:write:order:place",
      { customerName: "Carol", product: "Same" },
      customer,
    );

    expect(first.id).not.toBe(second.id);
  });
});
