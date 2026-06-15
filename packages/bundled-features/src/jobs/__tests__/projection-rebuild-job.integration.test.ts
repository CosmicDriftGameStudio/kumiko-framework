// #362: das `jobs`-Feature registriert den framework-eigenen Single-Run-Job
// `jobs:job:projection-rebuild`. Sobald jobs komponiert ist, dispatcht
// `enqueueProjectionRebuild` einen getrackten, retrybaren Rebuild über BullMQ;
// der Worker ruft `rebuildProjection`. Ohne jobs fällt der Helper auf einen
// inline-Rebuild zurück (in migrations/__tests__/pending-rebuilds.* abgedeckt).

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  asRawClient,
  buildEntityTable,
  createEventStoreExecutor,
  createTenantDb,
  type DbConnection,
  integer,
  table as pgTable,
  selectMany,
  type TenantDb,
  uuid,
} from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createRegistry,
  createTextField,
  defineApply,
  defineFeature,
  type ProjectionDefinition,
} from "@cosmicdrift/kumiko-framework/engine";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { createJobRunner, type JobRunner } from "@cosmicdrift/kumiko-framework/jobs";
import {
  enqueueProjectionRebuild,
  PROJECTION_REBUILD_JOB,
} from "@cosmicdrift/kumiko-framework/migrations";
import { createProjectionStateTable } from "@cosmicdrift/kumiko-framework/pipeline";
import {
  createTestDb,
  createTestRedis,
  type TestDb,
  type TestRedis,
  TestUsers,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { sleep } from "@cosmicdrift/kumiko-framework/testing";
import { createJobsFeature } from "../feature";
import { createJobRunLogger } from "../job-run-logger";
import { jobRunLogsTable, jobRunsTable } from "../job-run-table";

const itemEntity = createEntity({
  table: "read_rebuild_items",
  fields: {
    groupId: createTextField({ required: true }),
    name: createTextField({ required: true }),
  },
});
const itemTable = buildEntityTable("rebuild-item", itemEntity);
const executor = createEventStoreExecutor(itemTable, itemEntity, { entityName: "rebuild-item" });

const countsTable = pgTable("read_rebuild_counts", {
  groupId: uuid("group_id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  itemCount: integer("item_count").notNull().default(0),
});

// Eigene (explizite) Projektion — der Executor füllt sie NICHT live, sie wird
// ausschließlich vom Rebuild materialisiert. Count==2 nach dem Job beweist also
// den Replay, nicht den Live-Write.
const countsProjection: ProjectionDefinition = {
  name: "rebuild-counts",
  source: "rebuild-item",
  table: countsTable,
  apply: {
    "rebuild-item.created": defineApply<{ groupId: string }>(async (event, tx) => {
      await asRawClient(tx).unsafe(
        `INSERT INTO "read_rebuild_counts" (group_id, tenant_id, item_count) VALUES ($1::uuid, $2::uuid, 1)
         ON CONFLICT (group_id) DO UPDATE SET item_count = read_rebuild_counts.item_count + 1`,
        [event.payload.groupId, event.tenantId],
      );
    }),
  },
};

const PROJECTION = "rebuildtest:projection:rebuild-counts";
const GROUP = "00000000-0000-4000-8000-000000000001";

const appFeature = defineFeature("rebuildtest", (r) => {
  r.entity("rebuild-item", itemEntity);
  r.projection(countsProjection);
});

const admin = TestUsers.admin;
const registry = createRegistry([appFeature, createJobsFeature()]);

let testDb: TestDb;
let testRedis: TestRedis;
let db: DbConnection;
let tdb: TenantDb;
let jobRunner: JobRunner;

beforeAll(async () => {
  testDb = await createTestDb();
  testRedis = await createTestRedis();
  db = testDb.db;

  await unsafeCreateEntityTable(db, itemEntity, "rebuild-item");
  await createEventsTable(db);
  await createProjectionStateTable(db);
  await unsafePushTables(db, { readRebuildCounts: countsTable, jobRunsTable, jobRunLogsTable });
  tdb = createTenantDb(db, admin.tenantId);

  const redisUrl = `redis://${testRedis.redis.options.host}:${testRedis.redis.options.port}/${testRedis.redis.options.db}`;
  const logger = createJobRunLogger({ db, registry });
  jobRunner = createJobRunner({
    registry,
    context: { db },
    redisUrl,
    consumerLane: "worker",
    queueNamePrefix: `kumiko-projrebuild-test-${Date.now()}`,
    ...logger,
  });
  await jobRunner.start();
});

afterAll(async () => {
  await jobRunner.stop();
  await testDb.cleanup();
  await testRedis.cleanup();
});

async function getCount(): Promise<number | undefined> {
  const [row] = await selectMany<{ itemCount: number }>(db, countsTable, { groupId: GROUP });
  return row?.itemCount;
}

describe("projection-rebuild job (jobs feature composed)", () => {
  test("jobs feature registers the framework rebuild job under its qualified name", () => {
    expect(registry.getJob(PROJECTION_REBUILD_JOB)).toBeDefined();
  });

  test("enqueueProjectionRebuild dispatches a tracked job that refills the projection", async () => {
    await executor.create({ groupId: GROUP, name: "a" }, admin, tdb);
    await executor.create({ groupId: GROUP, name: "b" }, admin, tdb);
    // Live executor füllt die explizite Projektion nicht — Rebuild ist der einzige Weg.
    expect(await getCount()).toBeUndefined();

    const outcome = await enqueueProjectionRebuild(PROJECTION, { db, registry, jobRunner });
    expect(outcome.mode).toBe("dispatched");
    if (outcome.mode === "dispatched") {
      expect(outcome.bullJobId).toBeTruthy();
    }

    // Poll until the worker drained the queue and the rebuild refilled.
    for (let i = 0; i < 40 && (await getCount()) !== 2; i++) await sleep(200);
    expect(await getCount()).toBe(2);

    const runs = await selectMany<{ jobName: string; status: string }>(db, jobRunsTable, {
      jobName: PROJECTION_REBUILD_JOB,
    });
    expect(runs.length).toBeGreaterThanOrEqual(1);
    expect(runs.some((r) => r.status === "completed")).toBe(true);
  }, 30000);
});
