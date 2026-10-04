// Declared escape hatches of system crons are audited once per process (with a use counter),
// and the daily retention job prunes only old escapeHatchUse events through pruneEvents.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { appendRaw } from "@cosmicdrift/kumiko-framework/event-store/admin-api";
import {
  createNoopProvider,
  type MetricEvent,
  RecordingMeter,
} from "@cosmicdrift/kumiko-framework/observability";
import {
  drainEventConsumers,
  resetEventStore,
  setupTestStack,
  type TestStack,
  testTenantId,
} from "@cosmicdrift/kumiko-framework/stack";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import { generateId } from "@cosmicdrift/kumiko-framework/utils";
import { createConfigFeature } from "../../config/index.js";
import { createConfigResolver } from "../../config/resolver.js";
import { createTenantFeature } from "../../tenant/index.js";
import { createUserFeature } from "../../user/index.js";
import {
  DEFAULT_ESCAPE_HATCH_RETENTION_DAYS,
  ESCAPE_HATCH_RETENTION_DAYS_KEY,
} from "../constants.js";
import {
  createEscapeHatchAuditSink,
  ESCAPE_HATCH_USE_AGGREGATE_TYPE,
  ESCAPE_HATCH_USED_EVENT,
} from "../escape-hatch-audit-sink.js";
import { createAuditFeature } from "../feature.js";

const RETENTION_OVERRIDE_DAYS = 30;
const CRON_PROBE_JOB = "cron-probe:job:touch-raw";
const RETENTION_JOB = "audit:job:escape-hatch-retention";

const cronProbeFeature = defineFeature("cron-probe", (r) => {
  r.job({
    name: "touch-raw",
    // The worker lane really schedules this cron. A per-minute pattern fired a
    // fourth run whenever the test crossed a minute boundary; yearly keeps the
    // system-cron path without a real tick during the test.
    trigger: { cron: "0 0 0 1 1 *" },
    concurrency: "skip",
    escapeHatch: { reason: "cron probe reads raw", grants: ["unsafeRaw"] },
    handler: async (_payload, ctx) => {
      ctx.db.unsafeRaw();
    },
  });
});

const metricEvents: MetricEvent[] = [];
let stack: TestStack;

beforeAll(async () => {
  const noop = createNoopProvider();
  stack = await setupTestStack({
    features: [
      cronProbeFeature,
      createConfigFeature(),
      createTenantFeature(),
      createUserFeature(),
      createAuditFeature(),
    ],
    observability: { ...noop, meter: new RecordingMeter((e) => metricEvents.push(e)) },
    jobs: { consumerLane: "worker" },
    extraContext: ({ db }) => ({
      _escapeHatchAuditSink: createEscapeHatchAuditSink({ db }),
      configResolver: createConfigResolver({
        appOverrides: new Map([[ESCAPE_HATCH_RETENTION_DAYS_KEY, RETENTION_OVERRIDE_DAYS]]),
      }),
    }),
  });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  metricEvents.length = 0;
  await resetEventStore(stack);
});

function jobRunner() {
  if (!stack.jobRunner) throw new Error("setupTestStack({ jobs }) did not wire a jobRunner");
  return stack.jobRunner;
}

async function auditEventsFor(handler: string) {
  const rows = await selectMany<{ payload: { handler: string } }>(stack.db, eventsTable, {
    aggregateType: ESCAPE_HATCH_USE_AGGREGATE_TYPE,
  });
  return rows.filter((row) => row.payload.handler === handler);
}

async function seedEscapeHatchEvent(ageDays: number): Promise<string> {
  const aggregateId = generateId();
  await appendRaw(stack.db, {
    aggregateId,
    aggregateType: ESCAPE_HATCH_USE_AGGREGATE_TYPE,
    tenantId: testTenantId(1),
    expectedVersion: 0,
    type: ESCAPE_HATCH_USED_EVENT,
    payload: { handler: "seed", kind: "unsafe-raw", reason: "seed", actor: "system" },
    metadata: { userId: "system" },
    createdAt: getTemporal()
      .Now.instant()
      .subtract({ hours: ageDays * 24 }),
    createdBy: "system",
  });
  return aggregateId;
}

describe("system cron escape hatch audit", () => {
  test("three cron runs write one audit event and count three uses", async () => {
    for (let run = 0; run < 3; run++) {
      await jobRunner().dispatch(CRON_PROBE_JOB, {});
      await stack.drainJobs();
    }

    expect(await auditEventsFor(CRON_PROBE_JOB)).toHaveLength(1);
    const uses = metricEvents.filter(
      (e) =>
        e.name === "kumiko_escape_hatch_uses_total" &&
        e.labels?.["handler"] === CRON_PROBE_JOB &&
        e.labels?.["kind"] === "unsafe-raw",
    );
    expect(uses).toHaveLength(3);
  });

  test("a user-triggered run of the same job is audited per window, not once per process", async () => {
    await jobRunner().dispatch(CRON_PROBE_JOB, {});
    await stack.drainJobs();
    await resetEventStore(stack);

    await jobRunner().dispatch(CRON_PROBE_JOB, {}, { triggeredById: "user-1" });
    await stack.drainJobs();
    expect(await auditEventsFor(CRON_PROBE_JOB)).toHaveLength(1);
  });
});

describe("audit escape-hatch retention job", () => {
  test("defaults to 90 days", () => {
    expect(stack.registry.getConfigKey(ESCAPE_HATCH_RETENTION_DAYS_KEY)?.default).toBe(
      DEFAULT_ESCAPE_HATCH_RETENTION_DAYS,
    );
  });

  test("prunes escapeHatchUse events older than the configured period and keeps younger ones", async () => {
    const oldest = await seedEscapeHatchEvent(200);
    const old = await seedEscapeHatchEvent(RETENTION_OVERRIDE_DAYS + 15);
    const young = await seedEscapeHatchEvent(RETENTION_OVERRIDE_DAYS - 20);

    // pruneEvents refuses to delete past an active consumer's cursor
    await drainEventConsumers(stack, ["system:consumer:sse-broadcast"]);
    await jobRunner().dispatch(RETENTION_JOB, {});
    await stack.drainJobs();

    const remaining = new Set(
      (
        await selectMany<{ aggregateId: string }>(stack.db, eventsTable, {
          aggregateType: ESCAPE_HATCH_USE_AGGREGATE_TYPE,
        })
      ).map((row) => row.aggregateId),
    );
    expect(remaining.has(oldest)).toBe(false);
    expect(remaining.has(old)).toBe(false);
    expect(remaining.has(young)).toBe(true);
  });
});
