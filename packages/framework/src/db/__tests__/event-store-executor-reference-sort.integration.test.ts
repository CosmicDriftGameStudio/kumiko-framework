// fw#2741 — a list sorted by a `sortable` reference field must order by the
// target row's labelField, not by the FK column's UUID. The fixture pins three
// mutually distinct orderings (label / own id / referenced UUID) so a passing
// assertion can only come from the label expression, never from the column the
// read path used to fall back to.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { type BunTestDb, createTestDb } from "../../bun-db/__tests__/bun-test-db";
import { asRawClient } from "../../db/query";
import { createEntity, createTextField } from "../../engine";
import type { EntityDefinition } from "../../engine/types";
import { createEventsTable } from "../../event-store";
import { TestUsers, unsafeCreateEntityTable } from "../../stack";
import { seedRows } from "../../testing";
import { ensureTemporalPolyfill } from "../../time/polyfill";
import { createEventStoreExecutor } from "../event-store-executor";
import { buildEntityTable } from "../table-builder";
import { createTenantDb, type TenantDb } from "../tenant-db";

const customerEntity = createEntity({
  table: "read_ref_sort_customers",
  fields: { name: createTextField({ required: true }) },
});
const customerTable = buildEntityTable("refSortCustomer", customerEntity);

const orderEntity = createEntity({
  table: "read_ref_sort_orders",
  fields: {
    note: createTextField(),
    customerId: {
      type: "reference",
      entity: "refSortCustomer",
      labelField: "name",
      sortable: true,
    },
  },
});
const orderTable = buildEntityTable("refSortOrder", orderEntity);

// Same shape, but the reference column is Admin-only: a caller who cannot read
// the column must not be able to probe its target's label through the ordering
// (fw#2629 parity — the read path gates sorting like projection).
const restrictedOrderEntity = createEntity({
  table: "read_ref_sort_restricted_orders",
  fields: {
    note: createTextField(),
    customerId: {
      type: "reference",
      entity: "refSortCustomer",
      labelField: "name",
      sortable: true,
      access: { read: { Admin: "all" } },
    },
  },
});
const restrictedOrderTable = buildEntityTable("refSortRestrictedOrder", restrictedOrderEntity);

const CUSTOMER_MIKE = "11111111-1111-4111-8111-111111111111";
const CUSTOMER_ALPHA = "22222222-2222-4222-8222-222222222222";
const CUSTOMER_ZULU = "33333333-3333-4333-8333-333333333333";

// Own ids ascend a < b < c while the labels they point at do not, so the three
// candidate orderings are pairwise different:
//   by label:            [orderC, orderB, orderA]  (Alpha, Mike, Zulu)
//   by own id:           [orderA, orderB, orderC]
//   by customerId UUID:  [orderB, orderC, orderA]  (1111…, 2222…, 3333…)
const ORDER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORDER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ORDER_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function resolveEntity(name: string): EntityDefinition | undefined {
  return name === "refSortCustomer" ? customerEntity : undefined;
}

const referenceSort = {
  fields: [{ fieldName: "customerId", targetEntityName: "refSortCustomer", labelField: "name" }],
  resolveEntity,
};

let testDb: BunTestDb;
let tdbA: TenantDb;
const admin = TestUsers.admin;
const otherTenantAdmin = TestUsers.otherTenant;
const orderExec = createEventStoreExecutor(orderTable, orderEntity, { entityName: "refSortOrder" });
const restrictedOrderExec = createEventStoreExecutor(restrictedOrderTable, restrictedOrderEntity, {
  entityName: "refSortRestrictedOrder",
});

async function seedFixture(): Promise<void> {
  await seedRows(testDb.db, customerTable, [
    { id: CUSTOMER_MIKE, tenantId: admin.tenantId, name: "Mike" },
    { id: CUSTOMER_ALPHA, tenantId: admin.tenantId, name: "Alpha" },
    { id: CUSTOMER_ZULU, tenantId: admin.tenantId, name: "Zulu" },
  ]);
  await seedRows(testDb.db, orderTable, [
    { id: ORDER_A, tenantId: admin.tenantId, note: "a", customerId: CUSTOMER_ZULU },
    { id: ORDER_B, tenantId: admin.tenantId, note: "b", customerId: CUSTOMER_MIKE },
    { id: ORDER_C, tenantId: admin.tenantId, note: "c", customerId: CUSTOMER_ALPHA },
  ]);
}

const idsOf = (rows: readonly Record<string, unknown>[]): unknown[] => rows.map((r) => r["id"]);

beforeAll(async () => {
  await ensureTemporalPolyfill();
  testDb = await createTestDb();
  await unsafeCreateEntityTable(testDb.db, customerEntity, "refSortCustomer");
  await unsafeCreateEntityTable(testDb.db, orderEntity, "refSortOrder");
  await unsafeCreateEntityTable(testDb.db, restrictedOrderEntity, "refSortRestrictedOrder");
  await createEventsTable(testDb.db);
  tdbA = createTenantDb(testDb.db, admin.tenantId);
});

afterAll(async () => {
  await testDb.cleanup();
});

beforeEach(async () => {
  await asRawClient(testDb.db).unsafe(
    "TRUNCATE kumiko_events, read_ref_sort_customers, read_ref_sort_orders, " +
      "read_ref_sort_restricted_orders RESTART IDENTITY CASCADE",
  );
});

describe("event-store-executor.list — sortable reference fields (fw#2741)", () => {
  test("orders ascending by the target row's label, not by the FK UUID", async () => {
    await seedFixture();

    const res = await orderExec.list({ sort: "customerId", sortDirection: "asc" }, admin, tdbA, {
      referenceSort,
    });

    expect(idsOf(res.rows)).toEqual([ORDER_C, ORDER_B, ORDER_A]);
  });

  test("orders descending by the target row's label", async () => {
    await seedFixture();

    const res = await orderExec.list({ sort: "customerId", sortDirection: "desc" }, admin, tdbA, {
      referenceSort,
    });

    expect(idsOf(res.rows)).toEqual([ORDER_A, ORDER_B, ORDER_C]);
  });

  test("does not leak the sort-label projection into the returned rows", async () => {
    await seedFixture();

    const res = await orderExec.list({ sort: "customerId" }, admin, tdbA, { referenceSort });

    for (const row of res.rows) {
      expect(Object.keys(row)).not.toContain("__kumiko_sort_label");
    }
  });

  test("pages through the label order with a keyset cursor, no gaps or repeats", async () => {
    await seedFixture();

    const page1 = await orderExec.list(
      { sort: "customerId", sortDirection: "asc", limit: 2, totalCount: true },
      admin,
      tdbA,
      { referenceSort },
    );
    expect(idsOf(page1.rows)).toEqual([ORDER_C, ORDER_B]);
    expect(page1.total).toBe(3);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await orderExec.list(
      {
        sort: "customerId",
        sortDirection: "asc",
        limit: 2,
        cursor: page1.nextCursor as string,
        totalCount: true,
      },
      admin,
      tdbA,
      { referenceSort },
    );
    expect(idsOf(page2.rows)).toEqual([ORDER_A]);
    // totalCount counts the same WHERE the page used, so a cursored page counts
    // what is left. The assertion that matters here is that it answers at all:
    // the count binds only the WHERE params while ORDER BY now adds its own,
    // and Postgres rejects a statement handed more parameters than it uses.
    expect(page2.total).toBe(1);
  });

  test("a target row in a foreign tenant contributes no label and sorts last", async () => {
    await seedFixture();
    const foreignCustomer = "44444444-4444-4444-8444-444444444444";
    await seedRows(testDb.db, customerTable, [
      // Reference UUIDs carry no FK constraint, so a tenant-A row can point at
      // a tenant-B target. The tenant-scoped lookup must not resolve it —
      // otherwise "AAA Foreign" would sort first and leak its existence.
      { id: foreignCustomer, tenantId: otherTenantAdmin.tenantId, name: "AAA Foreign" },
    ]);
    const orderD = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    await seedRows(testDb.db, orderTable, [
      { id: orderD, tenantId: admin.tenantId, note: "d", customerId: foreignCustomer },
    ]);

    const res = await orderExec.list({ sort: "customerId", sortDirection: "asc" }, admin, tdbA, {
      referenceSort,
    });

    expect(idsOf(res.rows)).toEqual([ORDER_C, ORDER_B, ORDER_A, orderD]);
  });

  test("a reference field that did not opt into sortable falls back to id order, never UUID order", async () => {
    await seedFixture();

    const res = await orderExec.list({ sort: "customerId", sortDirection: "asc" }, admin, tdbA, {
      referenceSort: { fields: [], resolveEntity },
    });

    expect(idsOf(res.rows)).toEqual([ORDER_A, ORDER_B, ORDER_C]);
  });

  test("an unresolvable target entity falls back to id order, never UUID order", async () => {
    await seedFixture();

    const res = await orderExec.list({ sort: "customerId", sortDirection: "asc" }, admin, tdbA, {
      referenceSort: { fields: referenceSort.fields, resolveEntity: () => undefined },
    });

    expect(idsOf(res.rows)).toEqual([ORDER_A, ORDER_B, ORDER_C]);
  });

  test("a caller without read access to the reference column gets id order, an Admin gets label order", async () => {
    await seedRows(testDb.db, customerTable, [
      { id: CUSTOMER_MIKE, tenantId: admin.tenantId, name: "Mike" },
      { id: CUSTOMER_ALPHA, tenantId: admin.tenantId, name: "Alpha" },
      { id: CUSTOMER_ZULU, tenantId: admin.tenantId, name: "Zulu" },
    ]);
    await seedRows(testDb.db, restrictedOrderTable, [
      { id: ORDER_A, tenantId: admin.tenantId, note: "a", customerId: CUSTOMER_ZULU },
      { id: ORDER_B, tenantId: admin.tenantId, note: "b", customerId: CUSTOMER_MIKE },
      { id: ORDER_C, tenantId: admin.tenantId, note: "c", customerId: CUSTOMER_ALPHA },
    ]);

    const asUser = await restrictedOrderExec.list(
      { sort: "customerId", sortDirection: "asc" },
      TestUsers.user,
      tdbA,
      { referenceSort },
    );
    expect(idsOf(asUser.rows)).toEqual([ORDER_A, ORDER_B, ORDER_C]);

    const asAdmin = await restrictedOrderExec.list(
      { sort: "customerId", sortDirection: "asc" },
      admin,
      tdbA,
      { referenceSort },
    );
    expect(idsOf(asAdmin.rows)).toEqual([ORDER_C, ORDER_B, ORDER_A]);
  });
});
