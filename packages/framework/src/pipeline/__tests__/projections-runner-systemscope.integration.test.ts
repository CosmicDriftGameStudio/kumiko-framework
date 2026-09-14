// Pins the in-transaction inline-projection path over real HTTP for an
// r.systemScope() feature — the tenant-mode path is covered by domain-events-projections.integration.test.ts.

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import {
  integer as pgInteger,
  table as pgTable,
  text as pgText,
  uuid as pgUuid,
} from "../../db/dialect";
import { insertOne, selectMany } from "../../db/query";
import {
  createEntity,
  createTextField,
  defineEntityCreateHandler,
  defineFeature,
} from "../../engine";
import {
  resetEventStore,
  setupTestStack,
  type TestStack,
  TestUsers,
  unsafeCreateEntityTable,
} from "../../stack";

const sysItemEntity = createEntity({
  table: "read_sysproj_items",
  fields: { label: createTextField({ personal: false, reason: "test_fixture", required: true }) },
});

// No tenant_id column — mirrors the "system-scoped projection" table in
// query-projection.integration.test.ts, but fed by dispatch-write's
// in-transaction runProjections (r.projection) rather than a query handler.
const auditTable = pgTable("read_sysproj_item_audit", {
  itemId: pgUuid("item_id").primaryKey(),
  tenantId: pgUuid("tenant_id").notNull(),
  label: pgText("label").notNull(),
  hits: pgInteger("hits").notNull().default(1),
});

const sysProjFeature = defineFeature("sysproj", (r) => {
  r.systemScope();
  r.entity("sysproj-item", sysItemEntity);

  r.projection({
    name: "item-audit",
    source: "sysproj-item",
    table: auditTable,
    apply: {
      "sysproj-item.created": async (event, tx) => {
        const p = event.payload as { label?: string };
        await insertOne(tx, auditTable, {
          itemId: event.aggregateId,
          tenantId: event.tenantId,
          label: p.label ?? "?",
        });
      },
    },
  });

  r.writeHandler(
    defineEntityCreateHandler("sysproj-item", sysItemEntity, {
      access: { roles: ["SystemAdmin"] },
    }),
  );
});

let stack: TestStack;
const systemAdmin = TestUsers.systemAdmin;

beforeAll(async () => {
  stack = await setupTestStack({ features: [sysProjFeature], systemHooks: [] });
  await unsafeCreateEntityTable(stack.db, sysItemEntity, "sysproj-item");
});

afterAll(async () => {
  await stack.cleanup();
});

afterEach(async () => {
  await resetEventStore(stack, ["read_sysproj_items", "read_sysproj_item_audit"]);
});

describe("inline r.projection fires in-transaction for an r.systemScope() feature", () => {
  test("HTTP write lands both the entity row and the projection row", async () => {
    const created = await stack.http.writeOk<{ id: string }>(
      "sysproj:write:sysproj-item:create",
      { label: "widget-a" },
      systemAdmin,
    );

    const auditRows = await selectMany<{ itemId: string; label: string; tenantId: string }>(
      stack.db,
      auditTable,
      { itemId: created.id },
    );
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]?.label).toBe("widget-a");
    expect(auditRows[0]?.tenantId).toBe(systemAdmin.tenantId);
  });
});
