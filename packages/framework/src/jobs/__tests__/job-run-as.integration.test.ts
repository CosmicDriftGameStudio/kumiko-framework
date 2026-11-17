// Job `runAs`: ctx.systemUser carries the declared roles next to SYSTEM_ROLE, so
// ctx.dispatch.query and ctx.dispatch.write reach role-gated handlers. Without
// runAs the handler stays closed (see job-write-as.integration.test.ts).

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { waitFor } from "@cosmicdrift/kumiko-testing/helpers";
import {
  createTestRedis,
  type TestRedis,
  testRunQueueNamePrefix,
} from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import { ROLES } from "../../auth/roles.ts";
import { type BunTestDb, createTestDb } from "../../db/__tests__/query/bun-test-db.ts";
import {
  createRegistry,
  defineFeature,
  SYSTEM_USER_ID,
  type WriteResult,
} from "../../engine/index.ts";
import { createWorkerEntrypoint } from "../../entrypoint/index.ts";
import { createArchivedStreamsTable } from "../../event-store/index.ts";
import { createEventConsumerStateTable } from "../../pipeline/index.ts";

const RolesResult = z.object({ roles: z.array(z.string()) });
const StampResult = z.object({ userId: z.string(), roles: z.array(z.string()) });

const readResults: Array<z.infer<typeof RolesResult>> = [];
const writeResults: WriteResult[] = [];
const plainFailures: string[] = [];

const runAsProbeFeature = defineFeature("runAsProbe", (r) => {
  r.queryHandler({
    name: "whoami",
    schema: z.object({}),
    handler: async (query) => ({ roles: query.user.roles }),
    access: { roles: [ROLES.TenantAdmin] },
  });

  r.writeHandler({
    name: "stamp",
    schema: z.object({}),
    handler: async (event) => ({
      isSuccess: true as const,
      data: { userId: event.user.id, roles: event.user.roles },
    }),
    access: { roles: [ROLES.TenantAdmin] },
  });

  r.job({ name: "readAsTenantAdmin", trigger: { manual: true }, retries: 0, runAs: { roles: [ROLES.TenantAdmin] }, handler: async (_payload, ctx) => {
      const result = await ctx.dispatch.query("run-as-probe:query:whoami", {});
      readResults.push(RolesResult.parse(result));
    } });

  r.job({ name: "writeAsTenantAdmin", trigger: { manual: true }, retries: 0, runAs: { roles: [ROLES.TenantAdmin] }, handler: async (_payload, ctx) => {
      writeResults.push(await ctx.dispatch.write("run-as-probe:write:stamp", {}));
    } });

  r.job({ name: "readPlain", trigger: { manual: true }, retries: 0, handler: async (_payload, ctx) => {
    try {
      await ctx.dispatch.query("run-as-probe:query:whoami", {});
    } catch (error) {
      plainFailures.push(error instanceof Error ? error.message : String(error));
      throw error;
    }
  } });
});

const JWT = "job-run-as-test-secret-must-be-32-chars!!";

let testDb: BunTestDb;
let testRedis: TestRedis;

beforeAll(async () => {
  [testDb, testRedis] = await Promise.all([createTestDb(), createTestRedis()]);
  await createArchivedStreamsTable(testDb.db);
  await createEventConsumerStateTable(testDb.db);
});

afterAll(async () => {
  await Promise.all([testDb.cleanup(), testRedis.cleanup()]);
});

function redisUrl(): string {
  return `redis://${testRedis.redis.options.host}:${testRedis.redis.options.port}/${testRedis.redis.options.db}`;
}

async function runJob(label: string, jobName: string, done: () => void): Promise<void> {
  const worker = createWorkerEntrypoint({
    rowLevelSecurity: "off",
    registry: createRegistry([runAsProbeFeature]),
    context: { db: testDb.db, redis: testRedis.redis },
    jwtSecret: JWT,
    redisUrl: redisUrl(),
    queueNamePrefix: testRunQueueNamePrefix(label),
  });
  await worker.start();
  try {
    await worker.jobRunner.dispatch(jobName, {});
    await waitFor(done);
  } finally {
    await worker.stop();
  }
}

describe("job runAs", () => {
  test("ctx.dispatch.query reaches a role-gated query as the job's identity", async () => {
    readResults.length = 0;
    await runJob("job-run-as-read", "run-as-probe:job:read-as-tenant-admin", () => {
      expect(readResults).toHaveLength(1);
    });
    expect(readResults[0]?.roles).toContain("system");
    expect(readResults[0]?.roles).toContain(ROLES.TenantAdmin);
  });

  test("ctx.dispatch.write reaches a role-gated write, the actor stays the system user", async () => {
    writeResults.length = 0;
    await runJob("job-run-as-write", "run-as-probe:job:write-as-tenant-admin", () => {
      expect(writeResults).toHaveLength(1);
    });
    const result = writeResults[0];
    expect(result?.isSuccess).toBe(true);
    if (result?.isSuccess !== true) return;
    const stamp = StampResult.parse(result.data);
    expect(stamp.userId).toBe(SYSTEM_USER_ID);
    expect(stamp.roles).toContain(ROLES.TenantAdmin);
  });

  test("without runAs the role-gated query stays closed", async () => {
    plainFailures.length = 0;
    readResults.length = 0;
    await runJob("job-run-as-plain", "run-as-probe:job:read-plain", () => {
      expect(plainFailures).toHaveLength(1);
    });
    expect(readResults).toHaveLength(0);
  });
});
