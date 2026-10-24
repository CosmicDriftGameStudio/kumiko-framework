// Rebuild as the application role (NOSUPERUSER, NOBYPASSRLS, table owner, FORCE): the rebuild runs in
// system scope, leaves live rows, flags and policies as they were, and holds only an ACCESS SHARE lock
// after its policy check.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  createTestDb,
  type TestDb,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import type { ProjectionDefinition } from "@cosmicdrift/kumiko-types/projection";
import { integer, table as pgTable, uuid } from "../../db/dialect.ts";
import { createEventStoreExecutor } from "../../db/event-store-executor.ts";
import { extractPgError } from "../../db/pg-error.ts";
import { readRowLevelSecurityState } from "../../db/queries/rls-catalog.ts";
import { asRawClient, transaction } from "../../db/query.ts";
import { runInSystemRowLevelSecurityScope } from "../../db/row-level-security-scope.ts";
import { buildEntityTable } from "../../db/table-builder.ts";
import { unsafePushTables } from "../../db/table-push.ts";
import { createTenantDb } from "../../db/tenant-db.ts";
import {
  createEntity,
  createRegistry,
  createTextField,
  defineApply,
  defineFeature,
} from "../../engine/index.ts";

import { createProjectionStateTable, rebuildProjection } from "../../pipeline/index.ts";
import { createTestUser, testTenantId } from "../../seeding/seed-users.ts";

const LIVE_TABLE = "read_rebuild_app_per_group";
const LOCK_NOT_AVAILABLE = "55P03";

const itemEntity = createEntity({
  table: "read_rebuild_app_items",
  fields: {
    groupId: createTextField({ personal: false, reason: "test_fixture", required: true }),
    name: createTextField({ personal: false, reason: "test_fixture", required: true }),
  },
  softDelete: true,
});
const itemTable = buildEntityTable("rebuild-app-item", itemEntity);
const perGroupTable = pgTable(LIVE_TABLE, {
  groupId: uuid("group_id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  itemCount: integer("item_count").notNull().default(0),
});

const projection: ProjectionDefinition = {
  name: "app-per-group",
  source: "rebuild-app-item",
  table: perGroupTable,
  apply: {
    "rebuild-app-item.created": defineApply<{ groupId: string }>(async (event, tx) => {
      await asRawClient(tx).unsafe(
        `INSERT INTO "${LIVE_TABLE}" (group_id, tenant_id, item_count) VALUES ($1::uuid, $2::uuid, 1) ON CONFLICT (group_id) DO UPDATE SET item_count = "${LIVE_TABLE}".item_count + 1`,
        [event.payload.groupId, event.tenantId],
      );
    }),
  },
};
const feature = defineFeature("rebuildapp", (r) => {
  r.entity({ name: "rebuild-app-item", ...itemEntity });
  r.projection(projection);
});
const registry = createRegistry([feature]);
const projectionName = "rebuildapp:projection:app-per-group";
const executor = createEventStoreExecutor(itemTable, itemEntity, {
  entityName: "rebuild-app-item",
});

const tenantA = testTenantId(241);
const tenantB = testTenantId(242);
const groupA = "00000000-0000-4000-8000-000000000071";
const groupB = "00000000-0000-4000-8000-000000000072";

let testDb: TestDb;

const rebuild = (deps: object = {}) =>
  rebuildProjection(projectionName, { db: testDb.db, registry, ...deps });
const stateOf = () => readRowLevelSecurityState(testDb.db, "public", LIVE_TABLE);
const liveRows = () =>
  runInSystemRowLevelSecurityScope("test reads the live projection table across all tenants", () =>
    asRawClient(testDb.db).unsafe<Record<string, unknown>>(
      `SELECT * FROM "${LIVE_TABLE}" ORDER BY group_id`,
    ),
  );

async function codeOf(statement: Promise<unknown>): Promise<string | undefined> {
  try {
    await statement;
    return undefined;
  } catch (error) {
    return extractPgError(error)?.code;
  }
}

// Runs on a second connection, so it contends with the rebuild tx like another pod would.
function onSecondConnection(statement: string): Promise<unknown> {
  return transaction(testDb.outsideTransactionDb, async (tx) => {
    const raw = asRawClient(tx);
    await raw.unsafe(`SET LOCAL lock_timeout = '200ms'`);
    return raw.unsafe(statement);
  });
}

beforeAll(async () => {
  testDb = await createTestDb({ applicationRole: true });
  await unsafeCreateEntityTable(testDb.db, itemEntity, "rebuild-app-item");
  await createProjectionStateTable(testDb.db);
  await unsafePushTables(testDb.db, { perGroup: perGroupTable });
  for (const [tenantId, group, id] of [
    [tenantA, groupA, 241],
    [tenantB, groupB, 242],
  ] as const) {
    const user = createTestUser({ id, tenantId, roles: ["TenantAdmin"] });
    await executor.create(
      { groupId: group, name: `item-${id}` },
      user,
      createTenantDb({ db: testDb.db, tenantId }),
    );
  }
  await rebuild();
});

afterAll(async () => {
  await testDb.cleanup();
});

describe("rebuildProjection as the application role", () => {
  test("runs under FORCE and leaves the rows of both tenants and the policy state as they were", async () => {
    const rowsBefore = await liveRows();
    const stateBefore = await stateOf();
    expect(rowsBefore.map((row) => row["tenant_id"])).toEqual([tenantA, tenantB]);
    expect(stateBefore).toMatchObject({ enabled: true, forced: true });

    const result = await rebuild();

    expect(result.eventsProcessed).toBe(2);
    expect(await liveRows()).toEqual(rowsBefore);
    expect(await stateOf()).toEqual(stateBefore);
  });

  test("a second connection cannot change policies mid-rebuild but can still read", async () => {
    let policyChange: string | undefined;
    let plainRead: unknown;
    await rebuild({
      __test_onBeforeFence: async () => {
        policyChange = await codeOf(
          onSecondConnection(
            `CREATE POLICY mid_rebuild ON "${LIVE_TABLE}" AS PERMISSIVE FOR UPDATE TO PUBLIC USING (false)`,
          ),
        );
        plainRead = await codeOf(onSecondConnection(`SELECT count(*) FROM "${LIVE_TABLE}"`));
      },
    });

    expect(policyChange).toBe(LOCK_NOT_AVAILABLE);
    expect(plainRead).toBeUndefined();
    expect((await stateOf())?.policies.map((policy) => policy.name)).not.toContain("mid_rebuild");
  });
});
