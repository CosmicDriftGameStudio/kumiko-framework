import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createBooleanField, createEntity, createTextField } from "../../engine";
import {
  createEntityTable,
  createTestDb,
  createTestUser,
  type TestDb,
  TestUsers,
} from "../../testing";
import { buildDrizzleTable } from "../table-builder";
import { createTenantDb, type TenantDb } from "../tenant-db";

const entity = createEntity({
  table: "tenant_db_items",
  fields: {
    name: createTextField({ required: true }),
    status: createTextField({ default: "draft" }),
    isActive: createBooleanField({ default: true }),
  },
  softDelete: true,
});

const table = buildDrizzleTable("tenantDbItem", entity);

let testDb: TestDb;
const tenant1 = TestUsers.admin; // tenantId: 1
const tenant2 = TestUsers.otherTenant; // tenantId: 2

beforeAll(async () => {
  testDb = await createTestDb();
  await createEntityTable(testDb.db, entity, "tenantDbItem");
});

afterAll(async () => {
  await testDb.cleanup();
});

describe("createTenantDb", () => {
  describe("insert", () => {
    test("auto-injects tenantId into values", async () => {
      const tdb = createTenantDb(testDb.db, tenant1.tenantId);

      const [row] = await tdb.insert(table).values({ name: "Item 1" }).returning();
      expect(row["tenantId"]).toBe(1);
      expect(row["name"]).toBe("Item 1");
    });

    test("cannot override tenantId via values", async () => {
      const tdb = createTenantDb(testDb.db, tenant1.tenantId);

      const [row] = await tdb.insert(table).values({ name: "Sneaky", tenantId: 999 }).returning();
      // tenantId from TenantDb wins, not from values
      expect(row["tenantId"]).toBe(1);
    });
  });

  describe("select", () => {
    test("only returns rows for own tenant", async () => {
      const tdb1 = createTenantDb(testDb.db, tenant1.tenantId);
      const tdb2 = createTenantDb(testDb.db, tenant2.tenantId);

      await tdb1.insert(table).values({ name: "T1 Item" }).returning();
      await tdb2.insert(table).values({ name: "T2 Item" }).returning();

      const rows1 = await tdb1.select().from(table);
      const rows2 = await tdb2.select().from(table);

      expect(rows1.every((r) => (r as Record<string, unknown>)["tenantId"] === 1)).toBe(true);
      expect(rows2.every((r) => (r as Record<string, unknown>)["tenantId"] === 2)).toBe(true);
    });

    test("additional where conditions combine with tenant filter", async () => {
      const tdb = createTenantDb(testDb.db, tenant1.tenantId);

      await tdb.insert(table).values({ name: "findme", status: "active" }).returning();
      await tdb.insert(table).values({ name: "notme", status: "draft" }).returning();

      const rows = await tdb.select().from(table).where(eq(table["status"], "active"));

      expect(rows.length).toBeGreaterThanOrEqual(1);
      expect(
        rows.every(
          (r) =>
            (r as Record<string, unknown>)["tenantId"] === 1 &&
            (r as Record<string, unknown>)["status"] === "active",
        ),
      ).toBe(true);
    });
  });

  describe("update", () => {
    test("only updates rows for own tenant", async () => {
      const tdb1 = createTenantDb(testDb.db, tenant1.tenantId);
      const tdb2 = createTenantDb(testDb.db, tenant2.tenantId);

      const [row] = await tdb1.insert(table).values({ name: "T1 Update" }).returning();
      const id = (row as Record<string, unknown>)["id"] as number;

      // Tenant 2 tries to update Tenant 1's row
      const result = await tdb2
        .update(table)
        .set({ name: "Hacked" })
        .where(eq(table["id"], id))
        .returning();

      expect(result).toHaveLength(0); // no rows updated

      // Tenant 1 can update their own row
      const [updated] = await tdb1
        .update(table)
        .set({ name: "Updated" })
        .where(eq(table["id"], id))
        .returning();

      expect((updated as Record<string, unknown>)["name"]).toBe("Updated");
    });
  });

  describe("delete", () => {
    test("only deletes rows for own tenant", async () => {
      const tdb1 = createTenantDb(testDb.db, tenant1.tenantId);
      const tdb2 = createTenantDb(testDb.db, tenant2.tenantId);

      const [row] = await tdb1.insert(table).values({ name: "T1 Delete" }).returning();
      const id = (row as Record<string, unknown>)["id"] as number;

      // Tenant 2 tries to delete Tenant 1's row
      await tdb2.delete(table).where(eq(table["id"], id));

      // Row still exists for tenant 1
      const rows = await tdb1.select().from(table).where(eq(table["id"], id));
      expect(rows).toHaveLength(1);
    });
  });

  describe("cross-tenant isolation", () => {
    test("tenant cannot see, update, or delete other tenant data", async () => {
      const tdb1 = createTenantDb(testDb.db, tenant1.tenantId);
      const tdb2 = createTenantDb(testDb.db, tenant2.tenantId);

      // Tenant 1 creates data
      const [created] = await tdb1.insert(table).values({ name: "Secret" }).returning();
      const id = (created as Record<string, unknown>)["id"] as number;

      // Tenant 2 cannot see it
      const seen = await tdb2.select().from(table).where(eq(table["id"], id));
      expect(seen).toHaveLength(0);

      // Tenant 2 cannot update it
      const updated = await tdb2
        .update(table)
        .set({ name: "Hacked" })
        .where(eq(table["id"], id))
        .returning();
      expect(updated).toHaveLength(0);

      // Tenant 2 cannot delete it
      await tdb2.delete(table).where(eq(table["id"], id));
      const stillThere = await tdb1.select().from(table).where(eq(table["id"], id));
      expect(stillThere).toHaveLength(1);
    });
  });

  describe("select with columns", () => {
    test("supports column selection", async () => {
      const tdb = createTenantDb(testDb.db, tenant1.tenantId);

      await tdb.insert(table).values({ name: "ColSelect" }).returning();

      const rows = await tdb
        .select({ id: table["id"], name: table["name"] })
        .from(table)
        .where(eq(table["name"], "ColSelect"));

      expect(rows.length).toBeGreaterThanOrEqual(1);
      const row = rows[0] as Record<string, unknown>;
      expect(row["name"]).toBe("ColSelect");
      expect(row["id"]).toBeDefined();
      // Should not include other columns
      expect(row["status"]).toBeUndefined();
    });
  });

  describe("select with limit", () => {
    test("limits results", async () => {
      const tdb = createTenantDb(testDb.db, tenant1.tenantId);

      for (let i = 0; i < 5; i++) {
        await tdb
          .insert(table)
          .values({ name: `Limit${i}` })
          .returning();
      }

      const rows = await tdb.select().from(table).limit(2);
      expect(rows).toHaveLength(2);
    });
  });

  describe("update without returning", () => {
    test("updates rows without returning data", async () => {
      const tdb = createTenantDb(testDb.db, tenant1.tenantId);

      const [row] = await tdb.insert(table).values({ name: "NoReturn" }).returning();
      const id = (row as Record<string, unknown>)["id"] as number;

      // Update without .returning() — should not throw
      await tdb.update(table).set({ name: "NoReturnUpdated" }).where(eq(table["id"], id));

      const [updated] = await tdb.select().from(table).where(eq(table["id"], id));
      expect((updated as Record<string, unknown>)["name"]).toBe("NoReturnUpdated");
    });
  });

  describe("tenantId property", () => {
    test("exposes tenantId for use in cursor queries etc.", () => {
      const tdb = createTenantDb(testDb.db, 42);
      expect(tdb.tenantId).toBe(42);
    });
  });
});
