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
  text,
  uuid,
} from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createRegistry,
  createTextField,
  defineApply,
  defineFeature,
  defineMspApply,
  type ProjectionDefinition,
} from "@cosmicdrift/kumiko-framework/engine";
import { createJobRunner, type JobRunner } from "@cosmicdrift/kumiko-framework/jobs";
import {
  enqueueProjectionRebuild,
  PROJECTION_REBUILD_JOB,
} from "@cosmicdrift/kumiko-framework/migrations";
import {
  createEventConsumerStateTable,
  createProjectionStateTable,
} from "@cosmicdrift/kumiko-framework/pipeline";
import {
  createTestDb,
  createTestRedis,
  type TestDb,
  type TestRedis,
  TestUsers,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { waitFor } from "@cosmicdrift/kumiko-framework/testing";
import { createJobsFeature } from "../feature";
import { createJobRunLogger } from "../job-run-logger";
import { jobRunLogsTable, jobRunsTable } from "../job-run-table";

const itemEntity = createEntity({
  table: "read_rebuild_items",
  fields: {
    groupId: createTextField({ required: true, personal: false, reason: "technical_reference" }),
    name: createTextField({ required: true, personal: false, reason: "technical_reference" }),
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

const itemNamesTable = pgTable("read_rebuild_msp_names", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  name: text("name").notNull(),
});

const PROJECTION = "rebuildtest:projection:rebuild-counts";
const MSP_PROJECTION = "rebuildtest:projection:rebuild-item-names";
const GROUP = "00000000-0000-4000-8000-000000000001";

const appFeature = defineFeature("rebuildtest", (r) => {
  r.entity("rebuild-item", itemEntity);
  r.projection(countsProjection);
  r.multiStreamProjection({
    name: "rebuild-item-names",
    table: itemNamesTable,
    apply: {
      "rebuild-item.created": defineMspApply<{ name: string }>(async (event, tx) => {
        await asRawClient(tx).unsafe(
          `INSERT INTO "read_rebuild_msp_names" (id, tenant_id, name) VALUES ($1::uuid, $2::uuid, $3)
           ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
          [event.aggregateId, event.tenantId, event.payload.name],
        );
      }),
    },
  });
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
  await createProjectionStateTable(db);
  await createEventConsumerStateTable(db);
  await unsafePushTables(db, {
    readRebuildCounts: countsTable,
    readRebuildMspNames: itemNamesTable,
    jobRunsTable,
    jobRunLogsTable,
  });
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
    await waitFor(async () => (await getCount()) === 2, { delays: Array(40).fill(200) });
    expect(await getCount()).toBe(2);

    // getCount()==2 only proves rebuildProjection's own writes landed — the
    // run-completed event (job-run-logger's onJobComplete) is a separate
    // async append that starts only after the handler returns, so it can
    // still be in flight here. Poll status too instead of racing it.
    let runs: readonly { jobName: string; status: string }[] = [];
    await waitFor(
      async () => {
        runs = await selectMany<{ jobName: string; status: string }>(db, jobRunsTable, {
          jobName: PROJECTION_REBUILD_JOB,
        });
        return runs.some((r) => r.status === "completed");
      },
      { delays: Array(40).fill(200) },
    );
    expect(runs.length).toBeGreaterThanOrEqual(1);
    expect(runs.some((r) => r.status === "completed")).toBe(true);
  }, 30000);

  test("enqueueProjectionRebuild refills a multi-stream projection through the job", async () => {
    await executor.create({ groupId: GROUP, name: "msp-a" }, admin, tdb);
    await asRawClient(db).unsafe('DELETE FROM "read_rebuild_msp_names"');
    expect(await selectMany(db, itemNamesTable)).toHaveLength(0);

    const outcome = await enqueueProjectionRebuild(MSP_PROJECTION, { db, registry, jobRunner });
    if (outcome.mode !== "dispatched") throw new Error(`expected dispatch, got ${outcome.mode}`);

    await waitFor(async () => (await selectMany(db, itemNamesTable)).length > 0, {
      delays: Array(40).fill(200),
    });
    const names = (await selectMany<{ name: string }>(db, itemNamesTable)).map((r) => r.name);
    expect(names).toContain("msp-a");

    let status: string | undefined;
    await waitFor(
      async () => {
        const [run] = await selectMany<{ status: string }>(db, jobRunsTable, {
          bullJobId: outcome.bullJobId,
        });
        status = run?.status;
        return status === "completed" || status === "failed";
      },
      { delays: Array(40).fill(200) },
    );
    expect(status).toBe("completed");
  }, 30000);
});
