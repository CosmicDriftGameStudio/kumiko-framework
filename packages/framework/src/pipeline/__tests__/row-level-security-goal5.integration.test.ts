// Enforcement and escape hatches of row-level security on a test stack running as the application role.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import { integer, table, text, uuid } from "../../db/dialect.ts";
import { createEventStoreExecutor } from "../../db/event-store-executor.ts";
import { extractPgError } from "../../db/pg-error.ts";
import { readRowLevelSecurityState } from "../../db/queries/rls-catalog.ts";
import { asRawClient, insertOne, selectMany } from "../../db/query.ts";
import {
  assertNoActiveRowLevelSecurityScope,
  runInRowLevelSecurityScope,
  runInSystemRowLevelSecurityScope,
  tenantRowLevelSecurityScope,
} from "../../db/row-level-security-scope.ts";
import { buildEntityTable } from "../../db/table-builder.ts";
import { unsafePushTables } from "../../db/table-push.ts";
import { createTenantDb } from "../../db/tenant-db.ts";
import {
  createEntity,
  createTextField,
  defineApply,
  defineFeature,
  defineWriteHandler,
} from "../../engine/index.ts";
import { createProjectionStateTable, rebuildProjection } from "../../pipeline/index.ts";
import { TestUsers } from "../../seeding/seed-users.ts";

const INSUFFICIENT_PRIVILEGE = "42501";
const REASON = "goal 5 test reads and writes across tenants";

const itemsTable = table("fw4_goal5_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  label: text("label").notNull(),
});
const countsTable = table("fw4_goal5_counts", {
  groupId: uuid("group_id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  itemCount: integer("item_count").notNull().default(0),
});

const entity = createEntity({
  table: "read_goal5_entries",
  fields: { groupId: createTextField({ personal: false, reason: "test_fixture", required: true }) },
  softDelete: true,
});
const entryTable = buildEntityTable("goal5-entry", entity);
const entryExecutor = createEventStoreExecutor(entryTable, entity, { entityName: "goal5-entry" });

const admin = TestUsers.admin;
const other = TestUsers.otherTenant;
const labelsOf = (rows: readonly { label: string }[]) => rows.map((row) => row.label).sort();

async function pgCodeOf(statement: Promise<unknown>): Promise<string | undefined> {
  try {
    await statement;
    return undefined;
  } catch (error) {
    return extractPgError(error)?.code;
  }
}

const feature = defineFeature("goal5", (r) => {
  r.requires.projection("fw4_goal5_items");
  r.entity({ name: "goal5-entry", ...entity });
  r.projection({
    name: "per-group",
    source: "goal5-entry",
    table: countsTable,
    apply: {
      "goal5-entry.created": defineApply<{ groupId: string }>(async (event, tx) => {
        await asRawClient(tx).unsafe(
          `INSERT INTO "fw4_goal5_counts" (group_id, tenant_id, item_count) VALUES ($1::uuid, $2::uuid, 1) ON CONFLICT (group_id) DO UPDATE SET item_count = fw4_goal5_counts.item_count + 1`,
          [event.payload.groupId, event.tenantId],
        );
      }),
    },
  });

  r.writeHandler(
    defineWriteHandler({
      name: "raw-all",
      schema: z.object({}),
      access: { roles: ["Admin"] },
      escapeHatch: { reason: REASON },
      handler: async (_event, ctx) => ({
        isSuccess: true as const,
        data: { labels: labelsOf(await selectMany(ctx.db.unsafeRaw(), itemsTable)) },
      }),
    }),
  );
});

const systemFeature = defineFeature("goal5sys", (r) => {
  r.systemScope();
  r.writeHandler(
    defineWriteHandler({
      name: "raw-all",
      schema: z.object({}),
      access: { roles: ["Admin"] },
      escapeHatch: { reason: REASON },
      handler: async (_event, ctx) => {
        if (!ctx.systemDb) throw new Error("expected ctx.systemDb on a systemScope() handler");
        const labels = labelsOf(await selectMany(ctx.systemDb.unsafeRaw(REASON), itemsTable));
        return { isSuccess: true as const, data: { labels } };
      },
    }),
  );
  r.writeHandler(
    defineWriteHandler({
      name: "peek",
      schema: z.object({}),
      access: { roles: ["Admin"] },
      handler: async (_event, ctx) => {
        if (!ctx.systemDb) throw new Error("expected ctx.systemDb on a systemScope() handler");
        const db = ctx.systemDb.acknowledgeCrossTenant(REASON);
        return {
          isSuccess: true as const,
          data: { labels: labelsOf(await selectMany(db, itemsTable)) },
        };
      },
    }),
  );
});

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({ features: [feature, systemFeature] });
  await unsafePushTables(stack.unscopedDb, { items: itemsTable, counts: countsTable });
  await createProjectionStateTable(stack.unscopedDb);
  await insertOne(stack.db, itemsTable, { tenantId: admin.tenantId, label: "own" });
  await insertOne(stack.db, itemsTable, { tenantId: other.tenantId, label: "foreign" });
});

afterAll(async () => {
  await stack.cleanup();
});

describe("enforcement", () => {
  test("a statement outside any scope sees no row of a table holding two tenants", async () => {
    expect(await selectMany(stack.unscopedDb, itemsTable)).toEqual([]);
  });

  test("an INSERT for a foreign tenant under a tenant scope fails with 42501", async () => {
    const code = await runInRowLevelSecurityScope(tenantRowLevelSecurityScope(admin.tenantId), () =>
      pgCodeOf(insertOne(stack.unscopedDb, itemsTable, { tenantId: other.tenantId, label: "x" })),
    );
    expect(code).toBe(INSUFFICIENT_PRIVILEGE);
  });

  test("a tenant scope sees its own rows only, the system scope sees both tenants", async () => {
    const own = await runInRowLevelSecurityScope(tenantRowLevelSecurityScope(admin.tenantId), () =>
      selectMany<{ label: string }>(stack.unscopedDb, itemsTable),
    );
    expect(labelsOf(own)).toEqual(["own"]);
    const all = await runInSystemRowLevelSecurityScope(() =>
      selectMany<{ label: string }>(stack.unscopedDb, itemsTable),
    );
    expect(labelsOf(all)).toEqual(["foreign", "own"]);
  });

  test("assertNoActiveRowLevelSecurityScope throws inside a scope and passes outside", async () => {
    expect(() => assertNoActiveRowLevelSecurityScope("probe")).not.toThrow();
    await runInSystemRowLevelSecurityScope(async () => {
      expect(() => assertNoActiveRowLevelSecurityScope("probe")).toThrow(/probe.*active/);
    });
  });

  test("every framework table with a tenant_id column is enabled, forced and carries both policies", async () => {
    const tables = await runInSystemRowLevelSecurityScope(() =>
      asRawClient(stack.unscopedDb).unsafe<{ table_name: string }>(
        `SELECT table_name FROM information_schema.columns
         WHERE table_schema = 'public' AND column_name = 'tenant_id' AND table_name LIKE 'kumiko\\_%'
         ORDER BY table_name`,
      ),
    );
    expect(tables.map((row) => row.table_name)).toEqual([
      "kumiko_archived_streams",
      "kumiko_events",
      "kumiko_snapshots",
    ]);
    for (const { table_name: name } of tables) {
      const state = await readRowLevelSecurityState(stack.unscopedDb, "public", name);
      expect({ name, enabled: state?.enabled, forced: state?.forced }).toEqual({
        name,
        enabled: true,
        forced: true,
      });
      expect(state?.policies.map((policy) => policy.name)).toEqual([
        "kumiko_system_tenant_read",
        "kumiko_tenant_isolation",
      ]);
    }
  });
});

describe("escape hatches and scope hygiene", () => {
  test("ctx.db.unsafeRaw() in a handler with an escapeHatch sees the foreign rows", async () => {
    const data = await stack.http.writeOk<{ labels: string[] }>("goal5:write:raw-all", {}, admin);
    expect(data.labels).toEqual(["foreign", "own"]);
  });

  test("ctx.systemDb.unsafeRaw() in an r.systemScope() handler sees the foreign rows", async () => {
    const data = await stack.http.writeOk<{ labels: string[] }>(
      "goal5sys:write:raw-all",
      {},
      admin,
    );
    expect(data.labels).toEqual(["foreign", "own"]);
  });

  test("a tenant request after a system-scope request sees no foreign row on the same pool", async () => {
    await stack.http.writeOk("goal5sys:write:peek", {}, admin);
    const own = await runInRowLevelSecurityScope(tenantRowLevelSecurityScope(admin.tenantId), () =>
      selectMany<{ label: string }>(stack.unscopedDb, itemsTable),
    );
    expect(labelsOf(own)).toEqual(["own"]);
    expect(await selectMany(stack.unscopedDb, itemsTable)).toEqual([]);
  });
});

describe("rebuild on a table with row-level security", () => {
  test("keeps flags, policies and the rows of both tenants", async () => {
    for (const [user, group] of [
      [admin, "00000000-0000-4000-8000-000000000081"],
      [other, "00000000-0000-4000-8000-000000000082"],
    ] as const) {
      await entryExecutor.create(
        { groupId: group },
        user,
        createTenantDb({ db: stack.unscopedDb, tenantId: user.tenantId }),
      );
    }
    const rebuild = () =>
      rebuildProjection("goal5:projection:per-group", {
        db: stack.unscopedDb,
        registry: stack.registry,
      });
    const rowsOf = () =>
      runInSystemRowLevelSecurityScope(() =>
        asRawClient(stack.unscopedDb).unsafe(`SELECT * FROM fw4_goal5_counts ORDER BY group_id`),
      );
    await rebuild();
    const rowsBefore = await rowsOf();
    const stateBefore = await readRowLevelSecurityState(
      stack.unscopedDb,
      "public",
      "fw4_goal5_counts",
    );
    expect(rowsBefore).toHaveLength(2);
    expect(stateBefore).toMatchObject({ enabled: true, forced: true });

    await rebuild();

    expect(await rowsOf()).toEqual(rowsBefore);
    expect(await readRowLevelSecurityState(stack.unscopedDb, "public", "fw4_goal5_counts")).toEqual(
      stateBefore,
    );
  });
});
