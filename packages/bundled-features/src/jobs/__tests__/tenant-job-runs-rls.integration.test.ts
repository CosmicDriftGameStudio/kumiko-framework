// With row level security on, the run logger's tenant writes happen in job callbacks outside any request
// scope; the queued row must still land (the logger swallows write errors, so a rejection would stay silent).

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { insertOne, selectMany } from "@cosmicdrift/kumiko-framework/db";
import { createRegistry, defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import {
  runInRowLevelSecurityScope,
  tenantRowLevelSecurityScope,
} from "@cosmicdrift/kumiko-framework/internal/row-level-security";
import { createJobRunner, type JobRunner } from "@cosmicdrift/kumiko-framework/jobs";
import { testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { waitFor } from "@cosmicdrift/kumiko-testing/helpers";
import {
  createTestDb,
  createTestRedis,
  type TestDb,
  type TestRedis,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import { createJobsFeature } from "../feature.ts";
import { createJobRunLogger, isolateTenantRunWrite } from "../job-run-logger.ts";
import { jobRunLogsTable, jobRunsTable } from "../job-run-table.ts";
import { tenantJobFailuresTable } from "../tenant-job-failure-table.ts";
import { tenantJobRunsTable } from "../tenant-job-run-table.ts";

const tenantA = testTenantId(1);

const appFeature = defineFeature("rlsapp", (r) => {
  r.job("visible", { trigger: { manual: true }, tenantVisibleRun: {} }, async () => {});
});

let testDb: TestDb;
let testRedis: TestRedis;
let enqueuer: JobRunner;
let worker: JobRunner;

beforeAll(async () => {
  testDb = await createTestDb({ applicationRole: true });
  testRedis = await createTestRedis();
  const registry = createRegistry([appFeature, createJobsFeature()]);
  await unsafePushTables(testDb.db, {
    jobRunsTable,
    jobRunLogsTable,
    tenantJobFailuresTable,
    tenantJobRunsTable,
  });
  const { host, port, db } = testRedis.redis.options;
  const runnerOptions = {
    registry,
    context: { db: testDb.db },
    redisUrl: `redis://${host}:${port}/${db}`,
    queueNamePrefix: `kumiko-tenant-job-runs-rls-${Date.now()}`,
  };
  enqueuer = createJobRunner({
    ...runnerOptions,
    ...createJobRunLogger({ db: testDb.db, registry }),
  });
  worker = createJobRunner({
    ...runnerOptions,
    consumerLane: "worker",
    ...createJobRunLogger({ db: testDb.db, registry }),
  });
  await enqueuer.start();
});

afterAll(async () => {
  await worker.stop();
  await enqueuer.stop();
  await testDb.cleanup();
  await testRedis.cleanup();
});

describe("tenant job run rows under row level security", () => {
  test("a dispatch outside any scope records the queued row for its tenant", async () => {
    await enqueuer.dispatch("rlsapp:job:visible", { tenantId: tenantA });
    const rows = await runInRowLevelSecurityScope(tenantRowLevelSecurityScope(tenantA), () =>
      selectMany<{ status: string; jobName: string }>(testDb.db, tenantJobRunsTable, {
        jobName: "rlsapp:job:visible",
      }),
    );
    expect(rows.map((row) => row.status)).toEqual(["queued"]);
  });

  test("an unscoped tenant write through the isolation helper is swallowed and the queued row stays", async () => {
    await expect(
      isolateTenantRunWrite(
        async () => {
          await insertOne(testDb.db, tenantJobRunsTable, {
            tenantId: tenantA,
            jobName: "rlsapp:job:visible",
            bullJobId: "unscoped",
            status: "queued",
          });
        },
        "rlsapp:job:visible",
        "unscoped",
      ),
    ).resolves.toBeUndefined();
    const rows = await runInRowLevelSecurityScope(tenantRowLevelSecurityScope(tenantA), () =>
      selectMany<{ bullJobId: string }>(testDb.db, tenantJobRunsTable, {
        jobName: "rlsapp:job:visible",
      }),
    );
    expect(rows.map((row) => row.bullJobId)).not.toContain("unscoped");
    expect(rows.length).toBeGreaterThan(0);
  });

  test("the worker finishes the run and the completed row lands in the tenant", async () => {
    await worker.start();
    await waitFor(async () => {
      const rows = await runInRowLevelSecurityScope(tenantRowLevelSecurityScope(tenantA), () =>
        selectMany<{ status: string }>(testDb.db, tenantJobRunsTable, {
          jobName: "rlsapp:job:visible",
        }),
      );
      expect(rows.map((row) => row.status)).toEqual(["completed"]);
    });
  });
});
