// #760 — poison-event quarantine during projection rebuild.
//
// A single historical event whose apply throws used to abort the WHOLE
// rebuild (tx rollback, status failed) with no recovery path short of
// hand-editing the event. With quarantine mode the rebuild confines each
// apply to a savepoint: the poison event is skipped, recorded into
// kumiko_rebuild_dead_letters, and the replay completes.
//
// Covers both rebuild flavors:
//   - single-stream: RebuildDeps.errorPolicy.skipApplyErrors (per run)
//   - MSP: MspErrorMode.rebuild.skipApplyErrors (per definition — declared
//     API that was previously never honored by rebuildMultiStreamProjection)
// and both poison flavors:
//   - JS throw (no SQL executed)
//   - SQL error (aborts the tx → proves the savepoint is load-bearing)

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { z } from "zod";
import { integer as pgInteger, table as pgTable, uuid as pgUuid } from "../../db/dialect";
import { createEventStoreExecutor } from "../../db/event-store-executor";
import { asRawClient } from "../../db/query";
import { buildEntityTable } from "../../db/table-builder";
import { createTenantDb, type TenantDb } from "../../db/tenant-db";
import { createEntity, createTextField, defineApply, defineFeature } from "../../engine";
import type { ProjectionDefinition } from "../../engine/types";
import { append, createEventsTable } from "../../event-store";
import { listRebuildDeadLetters } from "../../event-store/rebuild-dead-letter";
import {
  createProjectionStateTable,
  getConsumerState,
  getProjectionState,
  rebuildMultiStreamProjection,
  rebuildProjection,
} from "../../pipeline";
import {
  setupTestStack,
  type TestStack,
  TestUsers,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "../../stack";

// --- Fixtures ---

const POISON_JS = "poison-js";
const POISON_SQL = "poison-sql";

const itemEntity = createEntity({
  table: "read_poison_items",
  fields: {
    groupId: createTextField({ required: true }),
    name: createTextField({ required: true }),
  },
});
const itemTable = buildEntityTable("poison-item", itemEntity);

const counterTable = pgTable("read_poison_counter", {
  groupId: pgUuid("group_id").primaryKey(),
  tenantId: pgUuid("tenant_id").notNull(),
  itemCount: pgInteger("item_count").notNull().default(0),
});

const mspCounterTable = pgTable("read_poison_msp_counter", {
  groupId: pgUuid("group_id").primaryKey(),
  tenantId: pgUuid("tenant_id").notNull(),
  itemCount: pgInteger("item_count").notNull().default(0),
});

async function bump(tx: unknown, tableName: string, groupId: string, tenantId: string) {
  await asRawClient(tx).unsafe(
    `INSERT INTO "${tableName}" (group_id, tenant_id, item_count) VALUES ($1::uuid, $2::uuid, 1) ON CONFLICT (group_id) DO UPDATE SET item_count = "${tableName}".item_count + 1`,
    [groupId, tenantId],
  );
}

// Poison by payload marker. POISON_SQL runs a genuinely failing statement so
// the surrounding tx would be in 25P02 without the savepoint.
async function applyOrPoison(
  tx: unknown,
  tableName: string,
  payload: { groupId: string; name: string },
  tenantId: string,
): Promise<void> {
  if (payload.name === POISON_JS) throw new Error("intentional js poison");
  if (payload.name === POISON_SQL) {
    await asRawClient(tx).unsafe(
      `INSERT INTO "${tableName}" (group_id, tenant_id, item_count) VALUES ('not-a-uuid', $1::uuid, 1)`,
      [tenantId],
    );
    return;
  }
  await bump(tx, tableName, payload.groupId, tenantId);
}

type ItemPayload = { groupId: string; name: string };

const poisonProjection: ProjectionDefinition = {
  name: "poison-counter",
  source: "poison-item",
  table: counterTable,
  apply: {
    "poison-item.created": defineApply<ItemPayload>(async (event, tx) => {
      await applyOrPoison(tx, "read_poison_counter", event.payload, event.tenantId);
    }),
  },
};

const MSP_EVENT_SHORT = "poison-noted";

const feature = defineFeature("poisontest", (r) => {
  r.entity("poison-item", itemEntity);
  r.projection(poisonProjection);
  const noted = r.defineEvent(MSP_EVENT_SHORT, z.object({ groupId: z.uuid(), name: z.string() }));
  r.multiStreamProjection({
    name: "poison-msp-counter",
    table: mspCounterTable,
    errorMode: { rebuild: { skipApplyErrors: true } },
    apply: {
      [noted.name]: async (event, tx) => {
        const p = event.payload as ItemPayload; // @cast-boundary engine-payload
        await applyOrPoison(tx, "read_poison_msp_counter", p, event.tenantId);
      },
    },
  });
});

const admin = TestUsers.admin;
const PROJECTION = "poisontest:projection:poison-counter";
const MSP = "poisontest:projection:poison-msp-counter";
const MSP_EVENT = "poisontest:event:poison-noted";
const GROUP = "00000000-0000-4000-8000-00000000cafe";

let stack: TestStack;
let tdb: TenantDb;

const executor = createEventStoreExecutor(itemTable, itemEntity, { entityName: "poison-item" });

beforeAll(async () => {
  stack = await setupTestStack({ features: [feature] });
  await unsafeCreateEntityTable(stack.db, itemEntity, "poison-item");
  await createEventsTable(stack.db);
  await createProjectionStateTable(stack.db);
  await unsafePushTables(stack.db, {
    poisonCounter: counterTable,
    poisonMspCounter: mspCounterTable,
  });
  tdb = createTenantDb(stack.db, admin.tenantId);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await asRawClient(stack.db).unsafe(
    `TRUNCATE kumiko_events, read_poison_items, read_poison_counter, read_poison_msp_counter, kumiko_projections RESTART IDENTITY CASCADE`,
  );
  await asRawClient(stack.db).unsafe(`DROP TABLE IF EXISTS kumiko_rebuild_dead_letters`);
  if (stack.eventDispatcher) await stack.eventDispatcher.ensureRegistered();
});

async function createItem(name: string): Promise<void> {
  await executor.create({ groupId: GROUP, name }, admin, tdb);
}

async function getCount(table: string): Promise<number | undefined> {
  const rows = (await asRawClient(stack.db).unsafe(
    `SELECT item_count FROM "${table}" WHERE group_id = $1::uuid`,
    [GROUP],
  )) as ReadonlyArray<{ item_count: number }>;
  return rows[0]?.item_count;
}

describe("rebuildProjection — poison event, strict default (#760)", () => {
  test("apply throw aborts the rebuild: status failed, no dead letters", async () => {
    await createItem("good-1");
    await createItem(POISON_JS);
    await createItem("good-2");

    await expect(
      rebuildProjection(PROJECTION, { db: stack.db, registry: stack.registry }),
    ).rejects.toThrow("intentional js poison");

    const state = await getProjectionState(stack.db, PROJECTION);
    expect(state?.status).toBe("failed");
    // Strict mode never provisions/records dead letters.
    const rows = (await asRawClient(stack.db).unsafe(
      `SELECT to_regclass('public.kumiko_rebuild_dead_letters') AS t`,
    )) as ReadonlyArray<{ t: string | null }>;
    expect(rows[0]?.t).toBeNull();
  });
});

describe("rebuildProjection — quarantine mode (#760)", () => {
  test("js- and sql-poison events are skipped, recorded, and the rebuild completes", async () => {
    await createItem("good-1");
    await createItem(POISON_JS);
    // sql-poison proves the savepoint: without it the failed statement puts
    // the whole rebuild tx into 25P02 and every later apply fails too.
    await createItem(POISON_SQL);
    await createItem("good-2");

    const result = await rebuildProjection(PROJECTION, {
      db: stack.db,
      registry: stack.registry,
      errorPolicy: { skipApplyErrors: true },
    });

    expect(result.eventsSkipped).toBe(2);
    expect(result.eventsProcessed).toBe(4);
    expect(await getCount("read_poison_counter")).toBe(2);

    const state = await getProjectionState(stack.db, PROJECTION);
    expect(state?.status).toBe("idle");

    const deadLetters = await listRebuildDeadLetters(stack.db, { projectionName: PROJECTION });
    expect(deadLetters).toHaveLength(2);
    const messages = deadLetters.map((d) => d.errorMessage).sort();
    expect(messages[0]).toContain("poison");
    expect(deadLetters.every((d) => d.eventType === "poison-item.created")).toBe(true);
    expect(deadLetters.every((d) => d.aggregateType === "poison-item")).toBe(true);
  });

  test("clean run in quarantine mode: zero skipped, no dead letters", async () => {
    await createItem("good-1");
    await createItem("good-2");

    const result = await rebuildProjection(PROJECTION, {
      db: stack.db,
      registry: stack.registry,
      errorPolicy: { skipApplyErrors: true },
    });

    expect(result.eventsSkipped).toBe(0);
    expect(await getCount("read_poison_counter")).toBe(2);
    expect(await listRebuildDeadLetters(stack.db, { projectionName: PROJECTION })).toHaveLength(0);
  });
});

describe("rebuildMultiStreamProjection — errorMode.rebuild.skipApplyErrors (#760)", () => {
  async function appendMspEvent(name: string, expectedVersion: number): Promise<void> {
    await append(stack.db, {
      aggregateId: GROUP,
      aggregateType: "poison-note",
      tenantId: admin.tenantId,
      expectedVersion,
      type: MSP_EVENT,
      payload: { groupId: GROUP, name },
      metadata: { userId: admin.id },
    });
  }

  test("declared rebuild policy is honored: poison skipped + recorded, cursor advanced", async () => {
    await appendMspEvent("good-1", 0);
    await appendMspEvent(POISON_SQL, 1);
    await appendMspEvent("good-2", 2);

    const result = await rebuildMultiStreamProjection(MSP, {
      db: stack.db,
      registry: stack.registry,
    });

    expect(result.eventsSkipped).toBe(1);
    expect(result.eventsProcessed).toBe(3);
    expect(await getCount("read_poison_msp_counter")).toBe(2);

    const deadLetters = await listRebuildDeadLetters(stack.db, { projectionName: MSP });
    expect(deadLetters).toHaveLength(1);
    expect(deadLetters[0]?.eventType).toBe(MSP_EVENT);

    const consumer = await getConsumerState(stack.db, MSP);
    expect(consumer?.lastProcessedEventId).toBe(result.lastProcessedEventId);
  });
});
