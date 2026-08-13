import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { type BunTestDb, createTestDb } from "../../bun-db/__tests__/bun-test-db";
import { createRegistry, defineFeature, type Registry } from "../../engine";
import { createTestRedis, type TestRedis, testTenantId } from "../../stack";
import { waitFor } from "../../testing";
import { createJobRunner, type JobRunner } from "../job-runner";

// r.systemScope() is feature-level (define-feature.ts), not per-job — so two
// features prove both sides, mirroring pipeline/__tests__/ctx-systemdb.integration.test.ts
// (the handler-dispatch counterpart from framework#2069/PR#2091).

type JobRunResult = {
  readonly name: "system" | "tenant" | "system-per-tenant";
  readonly present: boolean;
  // assertTenantMatch() must return a TenantDb whose `.raw` is the SAME
  // underlying DbConnection ctx.db carries — proves systemDb is bound to
  // the job's own tenant-scoped db, not a separate instance.
  readonly boundToRawDb: boolean | undefined;
  // A foreign tenantId must throw fail-closed (AccessDeniedError), same as
  // the HandlerContext.systemDb self-check.
  readonly foreignTenantThrew: boolean | undefined;
};

const results: JobRunResult[] = [];
const ownTenant = testTenantId(1);
const foreignTenant = testTenantId(2);

const systemScopedFeature = defineFeature("jobsystemdb-system", (r) => {
  r.systemScope();

  r.job("check", { trigger: { manual: true } }, async (_payload, ctx) => {
    if (!ctx.systemDb) {
      results.push({
        name: "system",
        present: false,
        boundToRawDb: undefined,
        foreignTenantThrew: undefined,
      });
      return;
    }
    const checked = ctx.systemDb.assertTenantMatch(ctx.systemUser.tenantId);
    let foreignTenantThrew = false;
    try {
      ctx.systemDb.assertTenantMatch(foreignTenant);
    } catch {
      foreignTenantThrew = true;
    }
    results.push({
      name: "system",
      present: true,
      boundToRawDb: checked.raw === ctx.db,
      foreignTenantThrew,
    });
  });

  // perTenant jobs go through a separate dispatch path (_perTenant: wrapper
  // fans out into one child job per tenant, job-runner.ts ~331-352) that
  // re-enqueues under the bare qualified name before handleJob rebuilds the
  // context — proves isJobSystemScoped() sees the same jobName fan-out
  // children get, not the "_perTenant:"-prefixed wrapper name.
  r.job(
    "check-per-tenant",
    { trigger: { manual: true }, perTenant: true },
    async (_payload, ctx) => {
      results.push({
        name: "system-per-tenant",
        present: ctx.systemDb !== undefined,
        boundToRawDb: undefined,
        foreignTenantThrew: undefined,
      });
    },
  );
});

const tenantScopedFeature = defineFeature("jobsystemdb-tenant", (r) => {
  r.job("check", { trigger: { manual: true } }, async (_payload, ctx) => {
    results.push({
      name: "tenant",
      present: ctx.systemDb !== undefined,
      boundToRawDb: undefined,
      foreignTenantThrew: undefined,
    });
  });
});

let testDb: BunTestDb;
let testRedis: TestRedis;
let registry: Registry;
let jobRunner: JobRunner;

beforeAll(async () => {
  testDb = await createTestDb();
  testRedis = await createTestRedis();

  registry = createRegistry([systemScopedFeature, tenantScopedFeature]);

  const redisUrl = `redis://${testRedis.redis.options.host}:${testRedis.redis.options.port}/${testRedis.redis.options.db}`;

  jobRunner = createJobRunner({
    registry,
    context: { db: testDb.db },
    redisUrl,
    consumerLane: "worker",
    queueNamePrefix: `kumiko-job-systemdb-test-${Date.now()}`,
    getActiveTenantIds: async () => [ownTenant],
  });

  await jobRunner.start();
});

afterAll(async () => {
  await jobRunner.stop();
  await testDb.cleanup();
  await testRedis.cleanup();
});

describe("JobContext.systemDb", () => {
  test("is present, tenant-bound and fail-closed for r.systemScope() jobs", async () => {
    results.length = 0;
    await jobRunner.dispatch("jobsystemdb-system:job:check", { tenantId: ownTenant });

    await waitFor(() => {
      const result = results.find((r) => r.name === "system");
      expect(result).toBeDefined();
      expect(result?.present).toBe(true);
      expect(result?.boundToRawDb).toBe(true);
      expect(result?.foreignTenantThrew).toBe(true);
    });
  });

  test("is absent for non-system-scoped jobs", async () => {
    results.length = 0;
    await jobRunner.dispatch("jobsystemdb-tenant:job:check", { tenantId: ownTenant });

    await waitFor(() => {
      const result = results.find((r) => r.name === "tenant");
      expect(result).toBeDefined();
      expect(result?.present).toBe(false);
    });
  });

  test("is present on the per-tenant fan-out child, not just the direct dispatch path", async () => {
    results.length = 0;
    await jobRunner.dispatch("jobsystemdb-system:job:check-per-tenant", {});

    await waitFor(() => {
      const result = results.find((r) => r.name === "system-per-tenant");
      expect(result).toBeDefined();
      expect(result?.present).toBe(true);
    });
  });
});
