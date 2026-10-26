// Whole-type removal as the production role (NOSUPERUSER, NOBYPASSRLS, table owner, FORCE RLS,
// mode "on"): the removal must reach the rows of every tenant, including the executor-managed
// read tables, and leave the kept type of both tenants byte-identical.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  applicationRoleUrlOf,
  createTestDb,
  type TestDb,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { createEventStoreExecutor } from "../../db/event-store-executor.ts";
import { readRowLevelSecurityState } from "../../db/queries/rls-catalog.ts";
import { asRawClient } from "../../db/query.ts";
import { runInSystemRowLevelSecurityScope } from "../../db/row-level-security-scope.ts";
import { buildEntityTable } from "../../db/table-builder.ts";
import { createTenantDb } from "../../db/tenant-db.ts";
import {
  createEntity,
  createRegistry,
  createTextField,
  defineFeature,
} from "../../engine/index.ts";
import { createArchivedStreamsTable } from "../../event-store/archive.ts";
import { createSnapshotsTable, saveSnapshot } from "../../event-store/snapshot.ts";
import { runEventsCli } from "../../events-cli.ts";
import { createTestUser, testTenantId } from "../../seeding/seed-users.ts";
import { removeAggregateTypes } from "../aggregate-type-removal.ts";
import { createEventConsumerStateTable } from "../event-consumer-state.ts";

const requiredText = { personal: false, reason: "test_fixture", required: true } as const;
const entityOf = (table: string) =>
  createEntity({ table, fields: { name: createTextField(requiredText) } });

const GONE_A = "rls-gone-a";
const GONE_B = "rls-gone-b";
const KEPT = "rls-kept";
const TABLE_GONE_A = "read_evprune_rls_gone_a";
const TABLE_GONE_B = "read_evprune_rls_gone_b";
const TABLE_KEPT = "read_evprune_rls_kept";
const entities = {
  [GONE_A]: entityOf(TABLE_GONE_A),
  [GONE_B]: entityOf(TABLE_GONE_B),
  [KEPT]: entityOf(TABLE_KEPT),
};

const feature = defineFeature("evprunerls", (r) => {
  for (const [name, entity] of Object.entries(entities)) r.entity({ name, ...entity });
});
const registry = createRegistry([feature]);

const tenantA = testTenantId(251);
const tenantB = testTenantId(252);
const removed = { types: [GONE_A, GONE_B] };

let testDb: TestDb;
let previousDatabaseUrl: string | undefined;

const system = <T>(fn: () => Promise<T>) =>
  runInSystemRowLevelSecurityScope("test reads and seeds across all tenants", fn);

async function sql<T>(text: string): Promise<readonly T[]> {
  return system(async () => (await asRawClient(testDb.db).unsafe(text)) as readonly T[]);
}

async function count(table: string, where = "TRUE"): Promise<number> {
  const rows = await sql<{ n: number }>(`SELECT COUNT(*)::int AS n FROM "${table}" WHERE ${where}`);
  return rows[0]?.n ?? 0;
}

async function seedTenant(tenantId: typeof tenantA, userNumber: number): Promise<void> {
  const user = createTestUser({ id: userNumber, tenantId, roles: ["TenantAdmin"] });
  const tdb = createTenantDb({ db: testDb.db, tenantId });
  for (const [name, entity] of Object.entries(entities)) {
    const executor = createEventStoreExecutor(buildEntityTable(name, entity), entity, {
      entityName: name,
    });
    await executor.create({ name: `${name}-${userNumber}` }, user, tdb);
    const [row] = await sql<{ id: string }>(
      `SELECT id FROM "${entity.table}" WHERE tenant_id = '${tenantId}'`,
    );
    await system(() =>
      saveSnapshot(testDb.db, {
        aggregateId: row?.id ?? "",
        tenantId,
        aggregateType: name,
        version: 1,
        state: { name: "snap" },
      }),
    );
  }
}

async function reseed(): Promise<void> {
  await sql(
    `TRUNCATE kumiko_events, kumiko_snapshots, ${Object.values(entities)
      .map((entity) => entity.table)
      .join(", ")} RESTART IDENTITY CASCADE`,
  );
  await seedTenant(tenantA, 251);
  await seedTenant(tenantB, 252);
}

beforeAll(async () => {
  testDb = await createTestDb({ applicationRole: true });
  for (const [name, entity] of Object.entries(entities)) {
    await unsafeCreateEntityTable(testDb.db, entity, name);
  }
  await createSnapshotsTable(testDb.db);
  await createArchivedStreamsTable(testDb.db);
  await createEventConsumerStateTable(testDb.db);
  previousDatabaseUrl = process.env["DATABASE_URL"];
  const baseUrl = process.env["TEST_DATABASE_URL"];
  if (!baseUrl) throw new Error("TEST_DATABASE_URL not set — required for this test file");
  process.env["DATABASE_URL"] = applicationRoleUrlOf(baseUrl, testDb.dbName);
});

afterAll(async () => {
  if (previousDatabaseUrl === undefined) delete process.env["DATABASE_URL"];
  else process.env["DATABASE_URL"] = previousDatabaseUrl;
  await testDb.cleanup();
});

async function expectKeptIntact(before: {
  events: readonly unknown[];
  rows: readonly unknown[];
}): Promise<void> {
  expect(
    await sql(`SELECT * FROM kumiko_events WHERE aggregate_type = '${KEPT}' ORDER BY id`),
  ).toEqual(before.events);
  expect(await sql(`SELECT * FROM "${TABLE_KEPT}" ORDER BY id`)).toEqual(before.rows);
  expect(await count("kumiko_snapshots", `aggregate_type = '${KEPT}'`)).toBe(2);
}

async function snapshotKept() {
  return {
    events: await sql(`SELECT * FROM kumiko_events WHERE aggregate_type = '${KEPT}' ORDER BY id`),
    rows: await sql(`SELECT * FROM "${TABLE_KEPT}" ORDER BY id`),
  };
}

async function expectRemovedGone(): Promise<void> {
  expect(await count("kumiko_events", `aggregate_type IN ('${GONE_A}', '${GONE_B}')`)).toBe(0);
  expect(await count("kumiko_snapshots", `aggregate_type IN ('${GONE_A}', '${GONE_B}')`)).toBe(0);
  expect(await count(TABLE_GONE_A)).toBe(0);
  expect(await count(TABLE_GONE_B)).toBe(0);
}

describe("aggregate type removal as the application role", () => {
  test("the fixture really runs under FORCE row level security", async () => {
    expect(await readRowLevelSecurityState(testDb.db, "public", TABLE_GONE_A)).toMatchObject({
      enabled: true,
      forced: true,
    });
  });

  test("dry run sees both tenants and deletes nothing", async () => {
    await reseed();
    const result = await removeAggregateTypes(testDb.db, registry, { ...removed, apply: false });

    expect(result.plan.stats).toEqual([
      { aggregateType: GONE_A, events: 2, aggregates: 2, tenants: 2 },
      { aggregateType: GONE_B, events: 2, aggregates: 2, tenants: 2 },
    ]);
    expect(await count(TABLE_GONE_A)).toBe(2);
  });

  test("apply removes events, snapshots and read rows of both tenants and keeps the kept type", async () => {
    await reseed();
    const kept = await snapshotKept();

    const result = await removeAggregateTypes(testDb.db, registry, { ...removed, apply: true });

    expect(result.deleted).toMatchObject({ events: 4, snapshots: 4 });
    expect(result.deleted?.projectionRows).toEqual({
      [`evprunerls:projection:${GONE_A}-entity`]: 2,
      [`evprunerls:projection:${GONE_B}-entity`]: 2,
    });
    await expectRemovedGone();
    await expectKeptIntact(kept);
    expect(await count(TABLE_KEPT)).toBe(2);
  });

  test("the CLI with row level security on does the same", async () => {
    await reseed();
    const kept = await snapshotKept();
    const lines: string[] = [];
    const out = { log: (l: string) => lines.push(l), err: (l: string) => lines.push(`ERR ${l}`) };
    const options = { features: [feature], rowLevelSecurity: "on" } as const;

    const dryRun = await runEventsCli(["prune", "--aggregate-type", GONE_A], out, options);
    expect(dryRun).toBe(0);
    expect(lines.join("\n")).toContain(`${GONE_A}: 2 events, 2 aggregates, 2 tenants`);
    expect(await count(TABLE_GONE_A)).toBe(2);

    const code = await runEventsCli(
      ["prune", "--aggregate-type", GONE_A, "--aggregate-type", GONE_B, "--apply"],
      out,
      options,
    );
    expect(code).toBe(0);
    await expectRemovedGone();
    await expectKeptIntact(kept);
  });
});
