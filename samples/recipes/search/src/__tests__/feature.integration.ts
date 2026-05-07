// Search Sample — Integration Test
// Proves: searchable fields indexed via system hook, search returns matches

import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  setupTestStack,
  type TestStack,
  TestUsers,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { productEntity, productFeature } from "../feature";

let stack: TestStack;

const admin = TestUsers.admin;

beforeAll(async () => {
  stack = await setupTestStack({ features: [productFeature] });
  await unsafeCreateEntityTable(stack.db, productEntity);
  await createEventsTable(stack.db);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  // Advance the dispatcher cursor past previous-test events so each test
  // starts with a clean horizon — same pattern as realtime-sse sample.
  await stack.eventDispatcher?.runOnce();
  stack.events.reset();
});

describe("search indexing", () => {
  test("created product is findable via search", async () => {
    await stack.http.writeOk(
      "shop:write:product:create",
      {
        name: "Wireless Mouse",
        brand: "Logitech",
        sku: "WM-001",
        category: "peripherals",
      },
      admin,
    );

    // Since D.4 search indexing runs as an async EventConsumer — drain the
    // dispatcher before asserting.
    await stack.eventDispatcher?.runOnce();

    // Search via SearchAdapter directly
    const results = await stack.search.search("00000000-0000-4000-8000-000000000001", "wireless", {
      filterType: "product",
    });
    expect(results.some((r) => r.entityType === "product")).toBe(true);
  });

  test("search via list handler returns matching rows", async () => {
    await stack.http.writeOk(
      "shop:write:product:create",
      {
        name: "Mechanical Keyboard",
        brand: "Cherry",
        sku: "MK-002",
      },
      admin,
    );
    await stack.eventDispatcher?.runOnce();

    const list = await stack.http.queryOk<{ rows: Record<string, unknown>[] }>(
      "shop:query:product:list",
      { search: "mechanical" },
      admin,
    );

    expect(list.rows.some((r) => r["name"] === "Mechanical Keyboard")).toBe(true);
  });

  test("search by brand field", async () => {
    await stack.http.writeOk(
      "shop:write:product:create",
      {
        name: "Budget Mouse",
        brand: "UniqueTestBrand",
        sku: "BM-003",
      },
      admin,
    );
    await stack.eventDispatcher?.runOnce();

    const results = await stack.search.search(
      "00000000-0000-4000-8000-000000000001",
      "UniqueTestBrand",
      { filterType: "product" },
    );
    expect(results.length).toBeGreaterThan(0);
  });

  test("non-searchable field not indexed", async () => {
    await stack.http.writeOk(
      "shop:write:product:create",
      {
        name: "Hidden SKU Product",
        sku: "SECRET-SKU-999",
        category: "test",
      },
      admin,
    );
    await stack.eventDispatcher?.runOnce();

    // SKU is not searchable, should not find via SKU search
    const results = await stack.search.search(
      "00000000-0000-4000-8000-000000000001",
      "SECRET-SKU-999",
      { filterType: "product" },
    );
    expect(results).toHaveLength(0);
  });
});
