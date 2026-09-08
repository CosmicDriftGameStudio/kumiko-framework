// fw#2660 — a text search on an entity must also match its `searchable`
// reference fields by the target row's labelField, not just the raw FK
// column (a GUID never contains the search term a human types). Covers the
// four cases the issue mandates: reference-only match, union with a native
// text match (no duplicates), cross-tenant target label match (must yield
// zero rows — the hard security constraint), and the >200-match cap (drop
// the reference clause, native search still applies).

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { type BunTestDb, createTestDb } from "../../bun-db/__tests__/bun-test-db";
import { asRawClient } from "../../db/query";
import { createEntity, createTextField } from "../../engine";
import type { EntityDefinition } from "../../engine/types";
import { createEventsTable } from "../../event-store";
import { createInMemorySearchAdapter } from "../../search";
import { TestUsers, unsafeCreateEntityTable } from "../../stack";
import { seedRows } from "../../testing";
import { ensureTemporalPolyfill } from "../../time/polyfill";
import { createEventStoreExecutor } from "../event-store-executor";
import { buildEntityTable } from "../table-builder";
import { createTenantDb, type TenantDb } from "../tenant-db";

const customerEntity = createEntity({
  table: "read_ref_search_customers",
  fields: {
    name: createTextField({ required: true }),
  },
});
const customerTable = buildEntityTable("refSearchCustomer", customerEntity);

const orderEntity = createEntity({
  table: "read_ref_search_orders",
  fields: {
    note: createTextField({ searchable: true }),
    customerId: {
      type: "reference",
      entity: "refSearchCustomer",
      labelField: "name",
      searchable: true,
    },
  },
});
const orderTable = buildEntityTable("refSearchOrder", orderEntity);

function resolveEntity(name: string): EntityDefinition | undefined {
  return name === "refSearchCustomer" ? customerEntity : undefined;
}

const referenceSearch = {
  fields: [{ fieldName: "customerId", targetEntityName: "refSearchCustomer", labelField: "name" }],
  resolveEntity,
};

let testDb: BunTestDb;
let tdbA: TenantDb;
let tdbB: TenantDb;
const admin = TestUsers.admin;
const otherTenantAdmin = TestUsers.otherTenant;
const orderExec = createEventStoreExecutor(orderTable, orderEntity, {
  entityName: "refSearchOrder",
});

beforeAll(async () => {
  await ensureTemporalPolyfill();
  testDb = await createTestDb();
  await unsafeCreateEntityTable(testDb.db, customerEntity, "refSearchCustomer");
  await unsafeCreateEntityTable(testDb.db, orderEntity, "refSearchOrder");
  await createEventsTable(testDb.db);
  tdbA = createTenantDb(testDb.db, admin.tenantId);
  tdbB = createTenantDb(testDb.db, otherTenantAdmin.tenantId);
});

afterAll(async () => {
  await testDb.cleanup();
});

beforeEach(async () => {
  await asRawClient(testDb.db).unsafe(
    "TRUNCATE kumiko_events, read_ref_search_customers, read_ref_search_orders RESTART IDENTITY CASCADE",
  );
});

describe("event-store-executor.list — searchable reference fields (fw#2660)", () => {
  test("matches via the reference column's label with no text-field match", async () => {
    const [acme] = await seedRows(testDb.db, customerTable, [
      { id: crypto.randomUUID(), tenantId: admin.tenantId, name: "Acme Corp" },
    ]);
    const [order] = await seedRows(testDb.db, orderTable, [
      {
        id: crypto.randomUUID(),
        tenantId: admin.tenantId,
        note: "totally unrelated note",
        customerId: (acme as { id: string }).id,
      },
    ]);

    const searchAdapter = createInMemorySearchAdapter();
    await searchAdapter.configure(admin.tenantId, { searchableFields: ["note"] });
    await searchAdapter.index(admin.tenantId, {
      entityType: "refSearchOrder",
      entityId: (order as { id: string }).id,
      weight: 1,
      fields: { note: "totally unrelated note" },
    });

    const res = await orderExec.list({ search: "acme" }, admin, tdbA, {
      searchAdapter,
      referenceSearch,
    });
    expect(res.rows.map((r) => r["id"])).toEqual([(order as { id: string }).id]);
  });

  test("unions a native text-field match with a reference-label match, no duplicates", async () => {
    const [acme, other] = await seedRows(testDb.db, customerTable, [
      { id: crypto.randomUUID(), tenantId: admin.tenantId, name: "Acme Corp" },
      { id: crypto.randomUUID(), tenantId: admin.tenantId, name: "Some Other Customer" },
    ]);
    const [textMatchOrder, refMatchOrder, decoyOrder] = await seedRows(testDb.db, orderTable, [
      {
        id: crypto.randomUUID(),
        tenantId: admin.tenantId,
        note: "great acme deal closed",
        customerId: (other as { id: string }).id,
      },
      {
        id: crypto.randomUUID(),
        tenantId: admin.tenantId,
        note: "nothing special here",
        customerId: (acme as { id: string }).id,
      },
      {
        id: crypto.randomUUID(),
        tenantId: admin.tenantId,
        note: "nothing special here either",
        customerId: (other as { id: string }).id,
      },
    ]);

    const searchAdapter = createInMemorySearchAdapter();
    await searchAdapter.configure(admin.tenantId, { searchableFields: ["note"] });
    for (const o of [textMatchOrder, refMatchOrder, decoyOrder]) {
      const row = o as { id: string; note: string };
      await searchAdapter.index(admin.tenantId, {
        entityType: "refSearchOrder",
        entityId: row.id,
        weight: 1,
        fields: { note: row.note },
      });
    }

    const res = await orderExec.list({ search: "acme" }, admin, tdbA, {
      searchAdapter,
      referenceSearch,
    });
    const ids = res.rows.map((r) => r["id"]);
    expect(ids.sort()).toEqual(
      [(textMatchOrder as { id: string }).id, (refMatchOrder as { id: string }).id].sort(),
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("a target label match in a foreign tenant never surfaces a row (mandatory)", async () => {
    const [confidential] = await seedRows(testDb.db, customerTable, [
      { id: crypto.randomUUID(), tenantId: admin.tenantId, name: "Confidential Co" },
    ]);
    // Reference UUIDs are freely settable (no FK constraint) — a tenant-B
    // row can point at a tenant-A id. If the target lookup weren't
    // tenant-scoped, this order would surface and leak that a
    // "Confidential Co" row exists in another tenant.
    const [order] = await seedRows(testDb.db, orderTable, [
      {
        id: crypto.randomUUID(),
        tenantId: otherTenantAdmin.tenantId,
        note: "unrelated",
        customerId: (confidential as { id: string }).id,
      },
    ]);

    const searchAdapter = createInMemorySearchAdapter();
    await searchAdapter.configure(otherTenantAdmin.tenantId, { searchableFields: ["note"] });
    await searchAdapter.index(otherTenantAdmin.tenantId, {
      entityType: "refSearchOrder",
      entityId: (order as { id: string }).id,
      weight: 1,
      fields: { note: "unrelated" },
    });

    const res = await orderExec.list({ search: "confidential" }, otherTenantAdmin, tdbB, {
      searchAdapter,
      referenceSearch,
    });
    expect(res.rows).toHaveLength(0);
  });

  test("drops the reference clause above 200 target matches — native search still applies", async () => {
    const fooCustomers = Array.from({ length: 201 }, (_, i) => ({
      id: crypto.randomUUID(),
      tenantId: admin.tenantId,
      name: `Foo Customer ${i}`,
    }));
    await seedRows(testDb.db, customerTable, fooCustomers);

    const [refOnlyOrder, textMatchOrder] = await seedRows(testDb.db, orderTable, [
      {
        id: crypto.randomUUID(),
        tenantId: admin.tenantId,
        note: "no keyword here",
        customerId: fooCustomers[5]?.id,
      },
      {
        id: crypto.randomUUID(),
        tenantId: admin.tenantId,
        note: "foo appears right here",
        customerId: fooCustomers[10]?.id,
      },
    ]);

    const searchAdapter = createInMemorySearchAdapter();
    await searchAdapter.configure(admin.tenantId, { searchableFields: ["note"] });
    for (const o of [refOnlyOrder, textMatchOrder]) {
      const row = o as { id: string; note: string };
      await searchAdapter.index(admin.tenantId, {
        entityType: "refSearchOrder",
        entityId: row.id,
        weight: 1,
        fields: { note: row.note },
      });
    }

    const res = await orderExec.list({ search: "foo" }, admin, tdbA, {
      searchAdapter,
      referenceSearch,
    });
    expect(res.rows.map((r) => r["id"])).toEqual([(textMatchOrder as { id: string }).id]);
  });
});
