// fw#2914 — JobContext.db is a tenant-filtered TenantDb; unfiltered access needs r.job({ escapeHatch }).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { type BunTestDb, createTestDb } from "../../bun-db/__tests__/bun-test-db";
import type { DbRunner } from "../../db/connection";
import { table, text, uuid } from "../../db/dialect";
import { insertOne, selectMany } from "../../db/query";
import { createRegistry, defineFeature, type Registry } from "../../engine";
import type { EscapeHatchUseEvent, JobContext } from "../../engine/types";
import { AccessDeniedError } from "../../errors";
import { createTestRedis, type TestRedis, testTenantId, unsafePushTables } from "../../stack";
import { waitFor } from "../../testing";
import { createJobRunner, type JobRunner } from "../job-runner";

const itemsTable = table("fw2914_job_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  label: text("label").notNull(),
});

const ownTenant = testTenantId(1);
const foreignTenant = testTenantId(2);
const DECLARED_REASON = "fw#2914 integration test — job counts items of every tenant";

type Outcome = {
  readonly job: "undeclared" | "declared";
  readonly mode?: string;
  readonly tenantId?: string;
  readonly labels?: readonly string[];
  readonly foreignWhereLabels?: readonly string[];
  readonly unsafeRawDenied?: boolean;
  readonly rawLabels?: readonly string[];
};

const outcomes: Outcome[] = [];
const auditEvents: EscapeHatchUseEvent[] = [];

function labelsOf(rows: readonly { label: string }[]): string[] {
  return rows.map((row) => row.label).sort();
}

const jobsFeature = defineFeature("jobtenantdb", (r) => {
  r.job("undeclared", { trigger: { manual: true } }, async (_payload, ctx) => {
    const own = await selectMany<{ label: string }>(ctx.db, itemsTable);
    const foreignWhere = await selectMany<{ label: string }>(ctx.db, itemsTable, {
      tenantId: foreignTenant,
    });
    let unsafeRawDenied = false;
    try {
      ctx.db.unsafeRaw("fw#2914 integration test — undeclared job reaching for raw");
    } catch (err) {
      unsafeRawDenied = err instanceof AccessDeniedError;
    }
    outcomes.push({
      job: "undeclared",
      mode: ctx.db.mode,
      tenantId: ctx.db.tenantId,
      labels: labelsOf(own),
      foreignWhereLabels: labelsOf(foreignWhere),
      unsafeRawDenied,
    });
  });

  r.job({
    name: "declared",
    trigger: { manual: true },
    escapeHatch: { reason: DECLARED_REASON },
    handler: async (_payload, ctx) => {
      const raw = ctx.db.unsafeRaw(DECLARED_REASON);
      const rows = await selectMany<{ label: string }>(raw, itemsTable);
      outcomes.push({ job: "declared", rawLabels: labelsOf(rows) });
    },
  });
});

let testDb: BunTestDb;
let testRedis: TestRedis;
let registry: Registry;
let jobRunner: JobRunner;

beforeAll(async () => {
  testDb = await createTestDb();
  testRedis = await createTestRedis();
  await unsafePushTables(testDb.db, { fw2914_job_items: itemsTable });
  await insertOne(testDb.db, itemsTable, { tenantId: ownTenant, label: "own" });
  await insertOne(testDb.db, itemsTable, { tenantId: foreignTenant, label: "foreign" });

  registry = createRegistry([jobsFeature]);
  const redisUrl = `redis://${testRedis.redis.options.host}:${testRedis.redis.options.port}/${testRedis.redis.options.db}`;
  jobRunner = createJobRunner({
    registry,
    context: {
      db: testDb.db,
      _escapeHatchAuditSink: async (event) => {
        auditEvents.push(event);
      },
    },
    redisUrl,
    consumerLane: "worker",
    queueNamePrefix: `kumiko-job-tenant-db-test-${Date.now()}`,
    getActiveTenantIds: async () => [ownTenant],
  });
  await jobRunner.start();
});

afterAll(async () => {
  await jobRunner.stop();
  await testDb.cleanup();
  await testRedis.cleanup();
});

describe("JobContext.db (fw#2914)", () => {
  test("is tenant-filtered to the job's tenant and unsafeRaw is denied without escapeHatch", async () => {
    outcomes.length = 0;
    auditEvents.length = 0;
    await jobRunner.dispatch("jobtenantdb:job:undeclared", { tenantId: ownTenant });

    await waitFor(() => {
      const outcome = outcomes.find((o) => o.job === "undeclared");
      expect(outcome).toBeDefined();
      expect(outcome?.mode).toBe("tenant");
      expect(outcome?.tenantId).toBe(ownTenant);
      expect(outcome?.labels).toEqual(["own"]);
      expect(outcome?.foreignWhereLabels).toEqual(["own"]);
      expect(outcome?.unsafeRawDenied).toBe(true);
    });
    expect(auditEvents).toHaveLength(0);
  });

  test("escapeHatch on r.job grants unfiltered access and reports one unsafe-raw audit event", async () => {
    outcomes.length = 0;
    auditEvents.length = 0;
    await jobRunner.dispatch("jobtenantdb:job:declared", { tenantId: ownTenant });

    await waitFor(() => {
      const outcome = outcomes.find((o) => o.job === "declared");
      expect(outcome?.rawLabels).toEqual(["foreign", "own"]);
      expect(auditEvents).toHaveLength(1);
    });
    expect(auditEvents[0]).toMatchObject({
      handler: "jobtenantdb:job:declared",
      kind: "unsafe-raw",
      reason: DECLARED_REASON,
      tenantId: ownTenant,
    });
  });

  test("r.job rejects an escapeHatch with an empty reason at registration", () => {
    const register = () =>
      defineFeature("jobtenantdb-empty", (r) => {
        r.job("bad", { trigger: { manual: true }, escapeHatch: { reason: "   " } }, async () => {});
      });
    expect(register).toThrow(/r\.job\("bad"\) declares \{ escapeHatch: \{ reason: "" \} \}/);
  });

  test("JobContext.db is not assignable to a raw DbRunner", () => {
    const acceptsRunner = (runner: DbRunner): DbRunner => runner;
    const ctx = { db: undefined } as unknown as JobContext;
    // @ts-expect-error — JobContext.db is a TenantDb, not a raw DbRunner (fw#2914)
    const leaked = () => acceptsRunner(ctx.db);
    expect(typeof leaked).toBe("function");
  });
});
