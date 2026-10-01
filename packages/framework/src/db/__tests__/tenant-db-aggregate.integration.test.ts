import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  setupTestStack,
  type TestStack,
  testTenantId,
  unsafePushTables,
} from "../../stack/index.js";
import { defineUnmanagedTable } from "../entity-table-meta.js";
import { insertOne } from "../query.js";
import { createTenantDb } from "../tenant-db.js";

const itemsTable = defineUnmanagedTable({
  tableName: "store_aggregate_items_it",
  columns: [
    {
      name: "id",
      pgType: "uuid",
      notNull: true,
      primaryKey: true,
      defaultSql: "gen_random_uuid()",
    },
    { name: "tenant_id", pgType: "uuid", notNull: true },
    { name: "status", pgType: "text", notNull: true },
    { name: "user_ref", pgType: "text", notNull: true },
    { name: "amount", pgType: "integer", notNull: true },
    { name: "created_at", pgType: "timestamptz", notNull: true },
  ],
});

const tenantA = testTenantId(81);
const tenantB = testTenantId(82);

type SeedRow = {
  readonly tenantId: string;
  readonly status: string;
  readonly userRef: string;
  readonly amount: number;
  readonly createdAt: string;
};

const seedRows: readonly SeedRow[] = [
  { tenantId: tenantA, status: "ok", userRef: "u1", amount: 10, createdAt: "2026-03-10T10:15:00Z" },
  { tenantId: tenantA, status: "ok", userRef: "u1", amount: 20, createdAt: "2026-03-10T10:45:00Z" },
  {
    tenantId: tenantA,
    status: "failed",
    userRef: "u2",
    amount: 30,
    createdAt: "2026-03-10T11:05:00Z",
  },
  { tenantId: tenantA, status: "ok", userRef: "u2", amount: 40, createdAt: "2026-03-10T22:30:00Z" },
  {
    tenantId: tenantA,
    status: "failed",
    userRef: "u3",
    amount: 50,
    createdAt: "2026-03-10T23:30:00Z",
  },
  {
    tenantId: tenantB,
    status: "ok",
    userRef: "u9",
    amount: 1000,
    createdAt: "2026-03-10T10:15:00Z",
  },
];

const epochMs = (iso: string): number => Temporal.Instant.from(iso).epochMilliseconds;

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({ features: [] });
  await unsafePushTables(stack.db, { items: itemsTable });
  for (const row of seedRows) {
    await insertOne(stack.db, itemsTable, {
      ...row,
      createdAt: Temporal.Instant.from(row.createdAt),
    });
  }
});

afterAll(async () => {
  await stack.cleanup();
});

describe("TenantDb.aggregate — measures", () => {
  test("count, countDistinct, sum and avg over the tenant's own rows", async () => {
    const tdb = createTenantDb(stack.db, tenantA);
    expect(await tdb.aggregate(itemsTable, { measure: { fn: "count" } })).toEqual([
      { keys: [], value: 5 },
    ]);
    expect(
      await tdb.aggregate(itemsTable, { measure: { fn: "countDistinct", field: "userRef" } }),
    ).toEqual([{ keys: [], value: 3 }]);
    expect(await tdb.aggregate(itemsTable, { measure: { fn: "sum", field: "amount" } })).toEqual([
      { keys: [], value: 150 },
    ]);
    expect(await tdb.aggregate(itemsTable, { measure: { fn: "avg", field: "amount" } })).toEqual([
      { keys: [], value: 30 },
    ]);
  });

  test("sum is 0 and avg is null when no row matches", async () => {
    const tdb = createTenantDb(stack.db, tenantA);
    const where = { status: "nonexistent" };
    expect(
      await tdb.aggregate(itemsTable, { measure: { fn: "sum", field: "amount" } }, where),
    ).toEqual([{ keys: [], value: 0 }]);
    expect(
      await tdb.aggregate(itemsTable, { measure: { fn: "avg", field: "amount" } }, where),
    ).toEqual([{ keys: [], value: null }]);
  });
});

describe("TenantDb.aggregate — grouping", () => {
  test("groups by a field and orders by value descending with a limit", async () => {
    const tdb = createTenantDb(stack.db, tenantA);
    const rows = await tdb.aggregate(itemsTable, {
      measure: { fn: "count" },
      groupBy: [{ field: "status" }],
      orderByValue: "desc",
    });
    expect(rows).toEqual([
      { keys: ["ok"], value: 3 },
      { keys: ["failed"], value: 2 },
    ]);
    const limited = await tdb.aggregate(itemsTable, {
      measure: { fn: "count" },
      groupBy: [{ field: "status" }],
      orderByValue: "desc",
      limit: 1,
    });
    expect(limited).toEqual([{ keys: ["ok"], value: 3 }]);
  });

  test("hour bucket returns epoch-ms keys per hour", async () => {
    const tdb = createTenantDb(stack.db, tenantA);
    const rows = await tdb.aggregate(itemsTable, {
      measure: { fn: "count" },
      groupBy: [{ field: "createdAt", bucket: "hour", timeZone: "UTC" }],
    });
    expect(rows).toEqual([
      { keys: [epochMs("2026-03-10T10:00:00Z")], value: 2 },
      { keys: [epochMs("2026-03-10T11:00:00Z")], value: 1 },
      { keys: [epochMs("2026-03-10T22:00:00Z")], value: 1 },
      { keys: [epochMs("2026-03-10T23:00:00Z")], value: 1 },
    ]);
  });

  test("day bucket honours the time zone", async () => {
    const tdb = createTenantDb(stack.db, tenantA);
    const utc = await tdb.aggregate(itemsTable, {
      measure: { fn: "count" },
      groupBy: [{ field: "createdAt", bucket: "day", timeZone: "UTC" }],
    });
    expect(utc).toEqual([{ keys: [epochMs("2026-03-10T00:00:00Z")], value: 5 }]);

    const berlin = await tdb.aggregate(itemsTable, {
      measure: { fn: "count" },
      groupBy: [{ field: "createdAt", bucket: "day", timeZone: "Europe/Berlin" }],
    });
    expect(berlin).toEqual([
      { keys: [epochMs("2026-03-09T23:00:00Z")], value: 4 },
      { keys: [epochMs("2026-03-10T23:00:00Z")], value: 1 },
    ]);
  });

  test("a bucket combined with a where filter keeps parameter order intact", async () => {
    const tdb = createTenantDb(stack.db, tenantA);
    const rows = await tdb.aggregate(
      itemsTable,
      {
        measure: { fn: "count" },
        groupBy: [{ field: "createdAt", bucket: "hour", timeZone: "UTC" }],
      },
      { status: "failed", createdAt: { gte: Temporal.Instant.from("2026-03-10T11:00:00Z") } },
    );
    expect(rows).toEqual([
      { keys: [epochMs("2026-03-10T11:00:00Z")], value: 1 },
      { keys: [epochMs("2026-03-10T23:00:00Z")], value: 1 },
    ]);
  });
});

describe("TenantDb.aggregate — tenant isolation", () => {
  test("tenant mode never sees another tenant's rows, even when asked to", async () => {
    const tdbB = createTenantDb(stack.db, tenantB);
    expect(await tdbB.aggregate(itemsTable, { measure: { fn: "count" } })).toEqual([
      { keys: [], value: 1 },
    ]);
    expect(
      await tdbB.aggregate(
        itemsTable,
        { measure: { fn: "sum", field: "amount" } },
        {
          tenantId: tenantA,
        },
      ),
    ).toEqual([{ keys: [], value: 1000 }]);
  });

  test("system mode aggregates across tenants", async () => {
    const systemDb = createTenantDb(stack.db, tenantA, "system");
    expect(await systemDb.aggregate(itemsTable, { measure: { fn: "count" } })).toEqual([
      { keys: [], value: 6 },
    ]);
  });
});
