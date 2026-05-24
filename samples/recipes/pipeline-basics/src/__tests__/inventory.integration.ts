// Pipeline Basics — Integration Test
//
// Drives every Tier-1 step end-to-end against a real Postgres
// stack via setupTestStack. The handlers under test live in
// ../feature.ts; this file proves they wire correctly to the
// HTTP dispatcher + event-store + projections.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  createTestUser,
  resetEventStore,
  setupTestStack,
  type TestStack,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { eq } from "drizzle-orm";
import { inventoryFeature, lowStockAlertsTable, productTable } from "../feature";

let stack: TestStack;
const admin = createTestUser({ roles: ["Admin"] });

beforeAll(async () => {
  // setupTestStack auto-pushes every table registered via r.projection() —
  // the inline `product-stock-counter` projection in the feature points
  // at productTable, so the aggregate table gets created automatically.
  // Only the custom non-aggregate projection (low_stock_alerts) needs an
  // explicit unsafePushTables — it has no projection registration.
  stack = await setupTestStack({ features: [inventoryFeature], systemHooks: [] });
  await unsafePushTables(stack.db, {
    read_inventory_low_stock_alerts: lowStockAlertsTable,
  });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await resetEventStore(stack, ["read_inventory_products", "read_inventory_low_stock_alerts"]);
  await stack.redis.flushNamespace();
  await stack.eventDispatcher?.ensureRegistered();
});

describe("Pipeline Basics — Inventory", () => {
  test("product:create — aggregate.create lands a row + returns id", async () => {
    const { id } = await stack.http.writeOk<{ id: string }>(
      "inventory:write:product:create",
      { sku: "SKU-001", name: "Widget", initialStock: 50 },
      admin,
    );

    expect(id).toMatch(/^[0-9a-f-]{36}$/);

    const [row] = await stack.db.select().from(productTable).where(eq(productTable.id, id));
    expect(row).toMatchObject({ sku: "SKU-001", name: "Widget", currentStock: 50 });
  });

  test("product:rename — first call updates, second call with same name is a no-op", async () => {
    const { id } = await stack.http.writeOk<{ id: string }>(
      "inventory:write:product:create",
      { sku: "SKU-002", name: "Gizmo", initialStock: 5 },
      admin,
    );

    const first = await stack.http.writeOk<{ id: string; renamed: boolean }>(
      "inventory:write:product:rename",
      { id, name: "Gizmo Pro" },
      admin,
    );
    expect(first.renamed).toBe(true);

    const second = await stack.http.writeOk<{ id: string; renamed: boolean }>(
      "inventory:write:product:rename",
      { id, name: "Gizmo Pro" },
      admin,
    );
    expect(second.renamed).toBe(false);
  });

  test("product:adjust-stock — below threshold inserts low-stock-alert", async () => {
    const { id } = await stack.http.writeOk<{ id: string }>(
      "inventory:write:product:create",
      { sku: "SKU-003", name: "Bolt", initialStock: 15 },
      admin,
    );

    const adjusted = await stack.http.writeOk<{ id: string; newStock: number }>(
      "inventory:write:product:adjust-stock",
      { id, delta: -10, reason: "shipped" },
      admin,
    );
    expect(adjusted.newStock).toBe(5);

    const [alert] = await stack.db
      .select()
      .from(lowStockAlertsTable)
      .where(eq(lowStockAlertsTable.productId, id));
    expect(alert).toBeDefined();
    expect(alert).toMatchObject({
      productId: id,
      sku: "SKU-003",
      currentStock: 5,
      threshold: 10,
    });
  });

  test("product:adjust-stock — back above threshold deletes the alert", async () => {
    const { id } = await stack.http.writeOk<{ id: string }>(
      "inventory:write:product:create",
      { sku: "SKU-004", name: "Nut", initialStock: 5 },
      admin,
    );

    // Initial create is below threshold; trigger an adjustment to seed the alert row.
    await stack.http.writeOk(
      "inventory:write:product:adjust-stock",
      { id, delta: 0, reason: "seed-alert" },
      admin,
    );
    const [seeded] = await stack.db
      .select()
      .from(lowStockAlertsTable)
      .where(eq(lowStockAlertsTable.productId, id));
    expect(seeded).toBeDefined();

    // Restock above threshold — branch.onFalse should delete the alert.
    await stack.http.writeOk(
      "inventory:write:product:adjust-stock",
      { id, delta: 20, reason: "restock" },
      admin,
    );
    const after = await stack.db
      .select()
      .from(lowStockAlertsTable)
      .where(eq(lowStockAlertsTable.productId, id));
    expect(after).toHaveLength(0);
  });

  test("product:bulk-adjust — forEach updates each product sequentially", async () => {
    const ids = await Promise.all(
      [1, 2, 3].map(async (n) => {
        const { id } = await stack.http.writeOk<{ id: string }>(
          "inventory:write:product:create",
          { sku: `SKU-BULK-${n}`, name: `Bulk-${n}`, initialStock: 100 },
          admin,
        );
        return id;
      }),
    );

    const result = await stack.http.writeOk<{ processed: number }>(
      "inventory:write:product:bulk-adjust",
      {
        adjustments: [
          { id: ids[0]!, delta: -5 },
          { id: ids[1]!, delta: -10 },
          { id: ids[2]!, delta: -50 },
        ],
      },
      admin,
    );
    expect(result.processed).toBe(3);

    // bulk-adjust deliberately omits the low-stock-alert branching —
    // that logic lives only in the single-product `adjust-stock`
    // handler. So even when bulk-adjustments push stock below the
    // threshold, no alert rows are written here.
    const alerts = await stack.db.select().from(lowStockAlertsTable);
    expect(alerts).toHaveLength(0);
  });

  test("product:archive — appendEvent + projection cleanup in one TX", async () => {
    const { id } = await stack.http.writeOk<{ id: string }>(
      "inventory:write:product:create",
      { sku: "SKU-ARCH", name: "Doomed", initialStock: 5 },
      admin,
    );

    // Seed the alert row by adjusting (initial-stock 5 < threshold 10).
    await stack.http.writeOk(
      "inventory:write:product:adjust-stock",
      { id, delta: 0, reason: "seed" },
      admin,
    );
    const [before] = await stack.db
      .select()
      .from(lowStockAlertsTable)
      .where(eq(lowStockAlertsTable.productId, id));
    expect(before).toBeDefined();

    await stack.http.writeOk(
      "inventory:write:product:archive",
      { id, reason: "discontinued" },
      admin,
    );

    const after = await stack.db
      .select()
      .from(lowStockAlertsTable)
      .where(eq(lowStockAlertsTable.productId, id));
    expect(after).toHaveLength(0);
  });

  test("report:archive-low-stock-products — read.findMany + forEach combined", async () => {
    // Seed three low-stock products.
    const ids = await Promise.all(
      ["A", "B", "C"].map(async (sku) => {
        const { id } = await stack.http.writeOk<{ id: string }>(
          "inventory:write:product:create",
          { sku: `SKU-LO-${sku}`, name: `Low-${sku}`, initialStock: 3 },
          admin,
        );
        // Trigger the low-stock-alert insertion.
        await stack.http.writeOk(
          "inventory:write:product:adjust-stock",
          { id, delta: 0, reason: "seed" },
          admin,
        );
        return id;
      }),
    );
    expect(ids).toHaveLength(3);

    const before = await stack.db.select().from(lowStockAlertsTable);
    expect(before).toHaveLength(3);

    const result = await stack.http.writeOk<{ archivedCount: number }>(
      "inventory:write:report:archive-low-stock-products",
      { reason: "ops-purge" },
      admin,
    );
    expect(result.archivedCount).toBe(3);

    const after = await stack.db.select().from(lowStockAlertsTable);
    expect(after).toHaveLength(0);
  });

  test("low-stock-alerts:list — query handler returns alert rows", async () => {
    const { id } = await stack.http.writeOk<{ id: string }>(
      "inventory:write:product:create",
      { sku: "SKU-LIST", name: "Alerted", initialStock: 2 },
      admin,
    );
    await stack.http.writeOk(
      "inventory:write:product:adjust-stock",
      { id, delta: 0, reason: "seed" },
      admin,
    );

    const result = await stack.http.queryOk<{ rows: Array<{ productId: string }> }>(
      "inventory:query:low-stock-alerts:list",
      {},
      admin,
    );
    expect(result.rows.map((row) => row.productId)).toContain(id);
  });
});
