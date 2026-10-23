// Projection rebuild on a live table with row level security: flags and policies survive the swap.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  createTestDb,
  type TestDb,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import {
  asProbe,
  createProbeRole,
  createRole,
  grantProbeDml,
  visibleTenants,
} from "../../db/__tests__/rls-probe.ts";
import { integer, table as pgTable, uuid } from "../../db/dialect.ts";
import { createEventStoreExecutor } from "../../db/event-store-executor.ts";
import { applyTableRowLevelSecurity } from "../../db/queries/ddl.ts";
import { readRowLevelSecurityState } from "../../db/queries/rls-catalog.ts";
import { asRawClient } from "../../db/query.ts";
import { buildEntityTable } from "../../db/table-builder.ts";
import { tableToMeta } from "../../db/table-push.ts";
import { createTenantDb, type TenantDb } from "../../db/tenant-db.ts";
import {
  createEntity,
  createRegistry,
  createTextField,
  defineApply,
  defineFeature,
} from "../../engine/index.ts";
import type { ProjectionDefinition } from "../../engine/types/index.ts";
import { SYSTEM_TENANT_ID } from "../../engine/types/index.ts";
import { createProjectionStateTable, rebuildProjection } from "../../pipeline/index.ts";
import { TestUsers, testTenantId } from "../../seeding/seed-users.ts";

const LIVE_TABLE = "read_rebuild_rls_per_group";
const MIXED_ROLE = '"Kumiko RLS Mixed Role"';

const itemEntity = createEntity({
  table: "read_rebuild_rls_items",
  fields: {
    groupId: createTextField({ personal: false, reason: "test_fixture", required: true }),
    name: createTextField({ personal: false, reason: "test_fixture", required: true }),
  },
  softDelete: true,
});
const itemTable = buildEntityTable("rebuild-rls-item", itemEntity);

const perGroupTable = pgTable(LIVE_TABLE, {
  groupId: uuid("group_id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  itemCount: integer("item_count").notNull().default(0),
});

type ItemCreated = { groupId: string };

const perGroupProjection: ProjectionDefinition = {
  name: "rls-per-group",
  source: "rebuild-rls-item",
  table: perGroupTable,
  apply: {
    "rebuild-rls-item.created": defineApply<ItemCreated>(async (event, tx) => {
      await asRawClient(tx).unsafe(
        `INSERT INTO "${LIVE_TABLE}" (group_id, tenant_id, item_count) VALUES ($1::uuid, $2::uuid, 1) ON CONFLICT (group_id) DO UPDATE SET item_count = "${LIVE_TABLE}".item_count + 1`,
        [event.payload.groupId, event.tenantId],
      );
    }),
  },
};

const feature = defineFeature("rebuildrls", (r) => {
  r.entity({ name: "rebuild-rls-item", ...itemEntity });
  r.projection(perGroupProjection);
});

const admin = TestUsers.admin;
const registry = createRegistry([feature]);
const projectionName = "rebuildrls:projection:rls-per-group";
const executor = createEventStoreExecutor(itemTable, itemEntity, {
  entityName: "rebuild-rls-item",
});
const otherTenant = testTenantId(231);
const group = "00000000-0000-4000-8000-000000000061";

let testDb: TestDb;
let tdb: TenantDb;

const rlsStateOf = () => readRowLevelSecurityState(testDb.db, "public", LIVE_TABLE);
const rebuild = () => rebuildProjection(projectionName, { db: testDb.db, registry });

async function clearRowLevelSecurity(): Promise<void> {
  const raw = asRawClient(testDb.db);
  for (const policy of (await rlsStateOf())?.policies ?? []) {
    await raw.unsafe(`DROP POLICY IF EXISTS "${policy.name}" ON "${LIVE_TABLE}"`);
  }
  await raw.unsafe(`ALTER TABLE "${LIVE_TABLE}" NO FORCE ROW LEVEL SECURITY`);
  await raw.unsafe(`ALTER TABLE "${LIVE_TABLE}" DISABLE ROW LEVEL SECURITY`);
}

beforeAll(async () => {
  testDb = await createTestDb();
  await unsafeCreateEntityTable(testDb.db, itemEntity, "rebuild-rls-item");
  await createProjectionStateTable(testDb.db);
  await unsafePushTables(testDb.db, { perGroup: perGroupTable });
  tdb = createTenantDb({ db: testDb.db, tenantId: admin.tenantId });
  await createProbeRole(testDb.db);
  await createRole(testDb.db, MIXED_ROLE);
});

afterAll(async () => {
  await clearRowLevelSecurity();
  await asRawClient(testDb.db).unsafe(`DROP ROLE IF EXISTS ${MIXED_ROLE}`);
  await testDb.cleanup();
});

beforeEach(async () => {
  await asRawClient(testDb.db).unsafe(
    `TRUNCATE kumiko_events, read_rebuild_rls_items, ${LIVE_TABLE}, kumiko_projections, kumiko_archived_streams RESTART IDENTITY CASCADE`,
  );
  await executor.create({ groupId: group, name: "item1" }, admin, tdb);
});

afterEach(clearRowLevelSecurity);

async function rawCatalog() {
  const raw = asRawClient(testDb.db);
  const [flags] = await raw.unsafe<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
    `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'public.${LIVE_TABLE}'::regclass`,
  );
  const policies = await raw.unsafe<{ polname: string }>(
    `SELECT polname FROM pg_policy WHERE polrelid = 'public.${LIVE_TABLE}'::regclass ORDER BY polname COLLATE "C"`,
  );
  return { flags, policyNames: policies.map((p) => p.polname) };
}

describe("rebuildProjection keeps row level security", () => {
  test("carries ENABLE, FORCE, kumiko and hand-written policies over and still enforces them", async () => {
    await rebuild();
    await applyTableRowLevelSecurity(testDb.db, tableToMeta(perGroupTable));
    const raw = asRawClient(testDb.db);
    await raw.unsafe(
      `CREATE POLICY handwritten_restrictive ON "${LIVE_TABLE}" AS RESTRICTIVE FOR UPDATE TO PUBLIC USING (true)`,
    );
    await raw.unsafe(
      `CREATE POLICY mixed_role_insert ON "${LIVE_TABLE}" AS PERMISSIVE FOR INSERT TO ${MIXED_ROLE} WITH CHECK (true)`,
    );
    const before = await rlsStateOf();
    expect(before?.policies.find((p) => p.name === "mixed_role_insert")).toMatchObject({
      rolesSql: MIXED_ROLE,
      withCheck: "true",
    });
    expect(before?.policies.find((p) => p.name === "mixed_role_insert")?.using).toBeUndefined();

    const result = await rebuild();

    expect(result.eventsProcessed).toBe(1);
    expect(await rlsStateOf()).toEqual(before);
    const catalog = await rawCatalog();
    expect(catalog.flags).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    expect(catalog.policyNames).toEqual([
      "handwritten_restrictive",
      "kumiko_system_tenant_read",
      "kumiko_tenant_isolation",
      "mixed_role_insert",
    ]);

    await raw.unsafe(
      `INSERT INTO "${LIVE_TABLE}" (group_id, tenant_id, item_count) VALUES ($1::uuid, $2::uuid, 5), ($3::uuid, $4::uuid, 7)`,
      [
        "00000000-0000-4000-8000-0000000000b2",
        otherTenant,
        "00000000-0000-4000-8000-0000000000c2",
        SYSTEM_TENANT_ID,
      ],
    );
    await grantProbeDml(testDb.db, [LIVE_TABLE]);
    const visible = await asProbe(testDb.db, { tenantId: admin.tenantId }, (probe) =>
      visibleTenants(probe, LIVE_TABLE),
    );
    expect(visible.sort()).toEqual([admin.tenantId, SYSTEM_TENANT_ID].sort());
    expect(await asProbe(testDb.db, {}, (probe) => visibleTenants(probe, LIVE_TABLE))).toEqual([]);
  });

  test("keeps a policy that exists without ENABLE", async () => {
    await asRawClient(testDb.db).unsafe(`CREATE POLICY rls_probe ON "${LIVE_TABLE}" USING (true)`);
    const before = await rlsStateOf();
    expect(before).toMatchObject({ enabled: false, forced: false });

    await rebuild();

    expect(await rlsStateOf()).toEqual(before);
  });

  test("keeps FORCE without ENABLE", async () => {
    await asRawClient(testDb.db).unsafe(`ALTER TABLE "${LIVE_TABLE}" FORCE ROW LEVEL SECURITY`);

    await rebuild();

    expect(await rlsStateOf()).toEqual({ enabled: false, forced: true, policies: [] });
  });
});
