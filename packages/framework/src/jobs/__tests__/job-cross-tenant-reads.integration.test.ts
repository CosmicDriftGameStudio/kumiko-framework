// JobContext.crossTenantReads: read-only, tenant-unfiltered, only with an unsafeRaw grant.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { type BunTestDb, createTestDb } from "../../bun-db/__tests__/bun-test-db.js";
import { table, text, uuid } from "../../db/dialect.js";
import { insertOne } from "../../db/query.js";
import { createRegistry, defineFeature } from "../../engine/index.js";
import type { EscapeHatchUseEvent } from "../../engine/types/index.js";
import { createPrometheusMeter, registerStandardMetrics } from "../../observability/index.js";
import {
  createTestRedis,
  type TestRedis,
  testTenantId,
  unsafePushTables,
} from "../../stack/index.js";
import { waitFor } from "../../testing/index.js";
import { createJobRunner, type JobRunner } from "../job-runner.js";

const itemsTable = table("fw_cross_tenant_reads_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  label: text("label").notNull(),
});

const ownTenant = testTenantId(1);
const foreignTenant = testTenantId(2);
const DECLARED_REASON = "cross-tenant-reads test — probe items of every tenant";

type Outcome = {
  readonly job: string;
  readonly hasReads: boolean;
  readonly labels?: readonly string[];
  readonly fetchedForeign?: string | undefined;
  readonly count?: number;
};
const outcomes: Outcome[] = [];
const auditEvents: EscapeHatchUseEvent[] = [];

async function probe(
  job: string,
  reads: import("../../engine/types/index.js").JobContext["crossTenantReads"],
): Promise<void> {
  if (!reads) {
    outcomes.push({ job, hasReads: false });
    return;
  }
  const rows = await reads.selectMany<{ label: string }>(itemsTable);
  const foreign = await reads.fetchOne<{ label: string }>(itemsTable, { tenantId: foreignTenant });
  const count = await reads.count(itemsTable);
  outcomes.push({
    job,
    hasReads: true,
    labels: rows.map((r) => r.label).sort(),
    fetchedForeign: foreign?.label,
    count,
  });
}

const jobsFeature = defineFeature("crosstenant", (r) => {
  r.job("plain", { trigger: { manual: true } }, (_payload, ctx) =>
    probe("plain", ctx.crossTenantReads),
  );
  r.job({
    name: "declared",
    trigger: { manual: true },
    escapeHatch: { reason: DECLARED_REASON },
    handler: (_payload, ctx) => probe("declared", ctx.crossTenantReads),
  });
  r.job({
    name: "sys-cron",
    trigger: { cron: "0 0 1 1 *" },
    escapeHatch: { reason: DECLARED_REASON },
    handler: (_payload, ctx) => probe("sysCron", ctx.crossTenantReads),
  });
});

const meter = createPrometheusMeter();
let testDb: BunTestDb;
let testRedis: TestRedis;
let jobRunner: JobRunner;

function meteredUses(handler: string): number {
  const slots = meter.snapshot().get("kumiko_escape_hatch_uses_total")?.slots ?? [];
  return slots
    .filter((s) => s.labels?.["handler"] === handler && s.labels?.["kind"] === "cross-tenant-read")
    .reduce((sum, s) => sum + ("value" in s ? s.value : 0), 0);
}

beforeAll(async () => {
  registerStandardMetrics(meter);
  testDb = await createTestDb();
  testRedis = await createTestRedis();
  await unsafePushTables(testDb.db, { fw_cross_tenant_reads_items: itemsTable });
  await insertOne(testDb.db, itemsTable, { tenantId: ownTenant, label: "own" });
  await insertOne(testDb.db, itemsTable, { tenantId: foreignTenant, label: "foreign" });

  const redisUrl = `redis://${testRedis.redis.options.host}:${testRedis.redis.options.port}/${testRedis.redis.options.db}`;
  jobRunner = createJobRunner({
    registry: createRegistry([jobsFeature]),
    context: {
      db: testDb.db,
      meter,
      _escapeHatchAuditSink: async (event) => {
        auditEvents.push(event);
      },
    },
    redisUrl,
    consumerLane: "worker",
    queueNamePrefix: `kumiko-cross-tenant-reads-${Date.now()}`,
    getActiveTenantIds: async () => [ownTenant],
  });
  await jobRunner.start();
});

afterAll(async () => {
  await jobRunner.stop();
  await testDb.cleanup();
  await testRedis.cleanup();
});

describe("JobContext.crossTenantReads", () => {
  test("is undefined without an unsafeRaw grant", async () => {
    outcomes.length = 0;
    await jobRunner.dispatch("crosstenant:job:plain", { tenantId: ownTenant });
    await waitFor(() =>
      expect(outcomes.find((o) => o.job === "plain")).toEqual({
        job: "plain",
        hasReads: false,
      }),
    );
  });

  test("reads rows of foreign tenants and audits each use per window", async () => {
    outcomes.length = 0;
    auditEvents.length = 0;
    await jobRunner.dispatch("crosstenant:job:declared", { tenantId: ownTenant });

    await waitFor(() => {
      expect(outcomes.find((o) => o.job === "declared")).toEqual({
        job: "declared",
        hasReads: true,
        labels: ["foreign", "own"],
        fetchedForeign: "foreign",
        count: 2,
      });
    });
    const reads = auditEvents.filter((e) => e.kind === "cross-tenant-read");
    expect(reads).toHaveLength(1);
    expect(reads[0]).toMatchObject({
      handler: "crosstenant:job:declared",
      reason: DECLARED_REASON,
      tenantId: ownTenant,
    });
  });

  test("a system cron audits once per process while the metric counts every use", async () => {
    outcomes.length = 0;
    auditEvents.length = 0;
    const handler = "crosstenant:job:sys-cron";
    for (let run = 1; run <= 2; run++) {
      await jobRunner.dispatch(handler, {});
      await waitFor(() => expect(outcomes.filter((o) => o.job === "sysCron")).toHaveLength(run));
    }

    expect(
      auditEvents.filter((e) => e.handler === handler && e.kind === "cross-tenant-read"),
    ).toHaveLength(1);
    expect(meteredUses(handler)).toBe(6);
  });
});
