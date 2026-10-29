// A reference's target is read through the target's own gates when its label is searched or
// ordered by: a target behind a readGate that cannot be resolved for the viewer must not be
// findable by its label, and its labels must not order the referencing rows.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { resetTestTables, seedRows } from "@cosmicdrift/kumiko-testing/helpers";
import { unsafeCreateEntityTable } from "@cosmicdrift/kumiko-testing/stack";
import type { EntityDefinition } from "@cosmicdrift/kumiko-types/fields";
import { createEntity, createTextField } from "../../engine/index.ts";
import { eventsTable } from "../../event-store/index.ts";
import { createInMemorySearchAdapter } from "../../search/index.ts";
import { TestUsers } from "../../seeding/seed-users.ts";
import { ensureTemporalPolyfill } from "../../time/polyfill.ts";
import { createEventStoreExecutor } from "../event-store-executor.ts";
import { buildEntityTable } from "../table-builder.ts";
import { createTenantDb, type TenantDb } from "../tenant-db.ts";
import { type BunTestDb, createTestDb } from "./query/bun-test-db.ts";

const text = () => createTextField({ required: true, personal: false, reason: "test_fixture" });

const linkEntity = createEntity({
  table: "read_ref_gate_links",
  fields: { customerId: text() },
});
const gatedCustomerEntity = createEntity({
  table: "read_ref_gate_customers",
  fields: { name: text() },
  readGate: { anyLink: { entity: "refGateLink", field: "customerId" } },
});
const plainCustomerEntity = createEntity({
  table: "read_ref_gate_plain_customers",
  fields: { name: text() },
});
const targets: Readonly<Record<string, EntityDefinition>> = {
  refGateCustomer: gatedCustomerEntity,
  refGatePlainCustomer: plainCustomerEntity,
};

function orderEntityFor(table: string, target: string) {
  return createEntity({
    table,
    fields: {
      note: createTextField({ searchable: true, personal: false, reason: "test_fixture" }),
      customerId: {
        type: "reference",
        entity: target,
        labelField: "name",
        searchable: true,
        sortable: true,
      },
    },
  });
}
const gatedOrderEntity = orderEntityFor("read_ref_gate_orders", "refGateCustomer");
const plainOrderEntity = orderEntityFor("read_ref_gate_plain_orders", "refGatePlainCustomer");

const referenceFor = (target: string) => ({
  fields: [{ fieldName: "customerId", targetEntityName: target, labelField: "name" }],
  resolveEntity: (name: string) => targets[name],
});

const admin = TestUsers.admin;
const gatedCustomerTable = buildEntityTable("refGateCustomer", gatedCustomerEntity);
const plainCustomerTable = buildEntityTable("refGatePlainCustomer", plainCustomerEntity);
const gatedOrderTable = buildEntityTable("refGateOrder", gatedOrderEntity);
const plainOrderTable = buildEntityTable("refGatePlainOrder", plainOrderEntity);
const gatedOrders = createEventStoreExecutor(gatedOrderTable, gatedOrderEntity, {
  entityName: "refGateOrder",
});
const plainOrders = createEventStoreExecutor(plainOrderTable, plainOrderEntity, {
  entityName: "refGatePlainOrder",
});

const ALPHA = "11111111-1111-4111-8111-111111111111";
const ZULU = "22222222-2222-4222-8222-222222222222";
// ids ascend a < b while the labels they point at descend, so label order differs from id order
const ORDER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORDER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

let testDb: BunTestDb;
let tdb: TenantDb;

async function seed(customerTable: typeof gatedCustomerTable, orderTable: typeof gatedOrderTable) {
  await seedRows(testDb.db, customerTable, [
    { id: ALPHA, tenantId: admin.tenantId, name: "Alpha Corp" },
    { id: ZULU, tenantId: admin.tenantId, name: "Zulu Corp" },
  ]);
  await seedRows(testDb.db, orderTable, [
    { id: ORDER_A, tenantId: admin.tenantId, note: "first", customerId: ZULU },
    { id: ORDER_B, tenantId: admin.tenantId, note: "second", customerId: ALPHA },
  ]);
}

async function searchAdapterFor(entityType: string) {
  const adapter = createInMemorySearchAdapter();
  await adapter.configure(admin.tenantId, { searchableFields: ["note"] });
  for (const [id, note] of [
    [ORDER_A, "first"],
    [ORDER_B, "second"],
  ] as const) {
    await adapter.index(admin.tenantId, { entityType, entityId: id, weight: 1, fields: { note } });
  }
  return adapter;
}

const idsOf = (rows: readonly Record<string, unknown>[]) => rows.map((row) => row["id"]);

beforeAll(async () => {
  await ensureTemporalPolyfill();
  testDb = await createTestDb();
  for (const [entity, name] of [
    [linkEntity, "refGateLink"],
    [gatedCustomerEntity, "refGateCustomer"],
    [plainCustomerEntity, "refGatePlainCustomer"],
    [gatedOrderEntity, "refGateOrder"],
    [plainOrderEntity, "refGatePlainOrder"],
  ] as const) {
    await unsafeCreateEntityTable(testDb.db, entity, name);
  }
  tdb = createTenantDb({ db: testDb.db, tenantId: admin.tenantId });
});
afterAll(async () => {
  await testDb.cleanup();
});
beforeEach(async () => {
  await resetTestTables(testDb.db, [
    eventsTable,
    "read_ref_gate_links",
    "read_ref_gate_orders",
    "read_ref_gate_plain_orders",
    "read_ref_gate_customers",
    "read_ref_gate_plain_customers",
  ]);
});

describe("reference search and sort through a readGate target", () => {
  test("an ungated target is still found by its label and orders by it", async () => {
    await seed(plainCustomerTable, plainOrderTable);
    const found = await plainOrders.list({ search: "alpha" }, admin, tdb, {
      searchAdapter: await searchAdapterFor("refGatePlainOrder"),
      referenceSearch: referenceFor("refGatePlainCustomer"),
    });
    expect(idsOf(found.rows)).toEqual([ORDER_B]);
    const sorted = await plainOrders.list({ sort: "customerId" }, admin, tdb, {
      referenceSort: referenceFor("refGatePlainCustomer"),
    });
    expect(idsOf(sorted.rows)).toEqual([ORDER_B, ORDER_A]);
  });

  test("a readGate target that cannot be resolved for the viewer is not findable by its label", async () => {
    await seed(gatedCustomerTable, gatedOrderTable);
    const found = await gatedOrders.list({ search: "alpha" }, admin, tdb, {
      searchAdapter: await searchAdapterFor("refGateOrder"),
      referenceSearch: referenceFor("refGateCustomer"),
    });
    expect(idsOf(found.rows)).toEqual([]);
  });

  test("the labels of a readGate target do not order the referencing rows", async () => {
    await seed(gatedCustomerTable, gatedOrderTable);
    const sorted = await gatedOrders.list({ sort: "customerId" }, admin, tdb, {
      referenceSort: referenceFor("refGateCustomer"),
    });
    // by label it would be [B, A]; without a readable label it falls back to id order
    expect(idsOf(sorted.rows)).toEqual([ORDER_A, ORDER_B]);
  });
});
