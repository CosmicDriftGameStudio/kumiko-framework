// E.1 — buildServer wires the event-dispatcher, drives delivery via .start(),
// wraps feature subscribers into tenant-scoped ctx.db, emits the lag gauge.
//
// Before E.1 the dispatcher lived only in test-stack.ts, not in buildServer.
// These tests pin the four claims that make the feature actually prod-ready:
//
//   1. buildServer returns a live eventDispatcher when consumers are wired.
//   2. r.postEvent subscribers get a TenantDb scoped to event.tenantId
//      (A1 default). systemScoped: true opts out to the raw DbConnection.
//   3. dispatcher.start() delivers without explicit runOnce; a handler
//      slower than pollIntervalMs doesn't queue overlapping passes.
//   4. kumiko_event_consumer_lag_events is emitted per pass.

import { sql } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, test } from "vitest";
import { createEventStoreExecutor } from "../../db/event-store-executor";
import { buildDrizzleTable } from "../../db/table-builder";
import { createTenantDb, type TenantDb } from "../../db/tenant-db";
import { createEntity, createTextField, defineFeature } from "../../engine";
import type { StoredEvent } from "../../event-store";
import {
  DEFAULT_SENSITIVE_CONFIG,
  type MetricEvent,
  type ObservabilityProvider,
  RecordingMeter,
  RecordingTracer,
} from "../../observability";
import { createEntityTable, setupTestStack, type TestStack, TestUsers } from "../../testing";

// --- Test fixtures ---

const wiringEntity = createEntity({
  table: "wiring_widgets",
  idType: "uuid",
  fields: {
    name: createTextField({ required: true }),
  },
  softDelete: true,
});
const wiringTable = buildDrizzleTable("wiringWidget", wiringEntity);
const executor = createEventStoreExecutor(wiringTable, wiringEntity, {
  entityName: "wiringWidget",
});

// Capture what the handler sees so we can assert on the context shape that
// the dispatcher passes in. Reset in afterEach.
type Observation = {
  event: StoredEvent;
  db: unknown;
};
let tenantObservations: Observation[] = [];
let systemObservations: Observation[] = [];
// A handler that sleeps a controllable amount of time. Drives the
// slow-handler / passInFlight test.
let slowHandlerDelayMs = 0;
let slowHandlerInvocations: Array<{ start: number; end: number }> = [];

const wiringFeature = defineFeature("wiring", (r) => {
  r.entity("wiringWidget", wiringEntity);

  r.postEvent("tenant-scoped", async (event, ctx) => {
    tenantObservations.push({ event, db: ctx.db });
  });

  r.postEvent(
    "system-scoped",
    async (event, ctx) => {
      systemObservations.push({ event, db: ctx.db });
    },
    { systemScoped: true },
  );

  r.postEvent("slow-observer", async () => {
    const start = Date.now();
    if (slowHandlerDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, slowHandlerDelayMs));
    }
    slowHandlerInvocations.push({ start, end: Date.now() });
  });
});

const admin = TestUsers.admin;
let stack: TestStack;
let tdb: TenantDb;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [wiringFeature],
    systemHooks: [],
  });
  await createEntityTable(stack.db.db, wiringEntity, "wiringWidget");
  tdb = createTenantDb(stack.db.db, admin.tenantId);
});

afterEach(async () => {
  tenantObservations = [];
  systemObservations = [];
  slowHandlerDelayMs = 0;
  slowHandlerInvocations = [];
  await stack.db.db.execute(
    sql`TRUNCATE events, wiring_widgets, kumiko_event_consumers RESTART IDENTITY CASCADE`,
  );
});

async function appendWidget(name: string): Promise<void> {
  await executor.create({ name }, admin, tdb);
}

// --- Tests ---

describe("E.1 — buildServer event-dispatcher wiring", () => {
  test("stack.eventDispatcher is wired when consumers exist", () => {
    // Regression guard against the D.5 bug where the outbox wiring was
    // removed and the dispatcher wiring wasn't added back.
    expect(stack.eventDispatcher).toBeDefined();
  });

  test("feature subscriber gets a TenantDb scoped to event.tenantId (A1 default)", async () => {
    await appendWidget("for-tenant-check");
    await stack.eventDispatcher?.runOnce();

    const obs = tenantObservations.find(
      (o) =>
        o.event.type === "wiringWidget.created" && o.event.payload["name"] === "for-tenant-check",
    );
    expect(obs).toBeDefined();
    // TenantDb has .tenantId + .mode; DbConnection does not.
    expect((obs?.db as { tenantId?: string }).tenantId).toBe(admin.tenantId);
    expect((obs?.db as { mode?: string }).mode).toBe("tenant");
  });

  test("systemScoped subscriber gets the raw DbConnection (no tenant wrap)", async () => {
    await appendWidget("for-system-check");
    await stack.eventDispatcher?.runOnce();

    const obs = systemObservations.find(
      (o) =>
        o.event.type === "wiringWidget.created" && o.event.payload["name"] === "for-system-check",
    );
    expect(obs).toBeDefined();
    // Raw DbConnection has neither `.tenantId` nor `.mode` — the handler is
    // trusted to scope itself when accessing other tenants is intentional.
    const db = obs?.db as Record<string, unknown> | null;
    expect(db).toBeDefined();
    expect(db?.["tenantId"]).toBeUndefined();
    expect(db?.["mode"]).toBeUndefined();
  });
});

describe("E.1 — .start() lifecycle + slow handler", () => {
  test("started dispatcher delivers events without an explicit runOnce", async () => {
    await stack.eventDispatcher?.start();
    try {
      await appendWidget("started-delivery");

      // pollIntervalMs in the test-stack is 50ms. Give the timer a few
      // ticks to observe the event.
      await waitFor(() => tenantObservations.length >= 1, 2000);
      expect(tenantObservations).toHaveLength(1);
      expect(tenantObservations[0]?.event.payload["name"]).toBe("started-delivery");
    } finally {
      await stack.eventDispatcher?.stop();
    }
  });

  test("slow handler doesn't queue overlapping passes (passInFlight serialises)", async () => {
    // 250ms handler >> 50ms pollIntervalMs — without passInFlight, the
    // setInterval would start a new pass every 50ms on top of the one in
    // flight. passInFlight must coalesce them. We verify: no two passes
    // ran concurrently.
    slowHandlerDelayMs = 250;

    await stack.eventDispatcher?.start();
    try {
      await appendWidget("slow-1");
      await appendWidget("slow-2");
      await appendWidget("slow-3");

      // Wait until all 3 slow-observer invocations have completed.
      await waitFor(() => slowHandlerInvocations.length >= 3, 5000);

      // Check: no invocation overlapped with the next — every pass
      // finished before the following one started. passInFlight does
      // its job.
      const sorted = [...slowHandlerInvocations].sort((a, b) => a.start - b.start);
      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1];
        const curr = sorted[i];
        if (!prev || !curr) continue;
        expect(curr.start).toBeGreaterThanOrEqual(prev.end);
      }
    } finally {
      await stack.eventDispatcher?.stop();
    }
  });
});

describe("E.1 — consumer-lag metric", () => {
  test("kumiko_event_consumer_lag_events is emitted per pass", async () => {
    // Build a dedicated stack with a RecordingMeter so we can read back
    // exactly which gauge events the dispatcher emitted.
    const metricEvents: MetricEvent[] = [];
    const meter = new RecordingMeter((e) => metricEvents.push(e));
    const tracer = new RecordingTracer({
      sensitiveConfig: DEFAULT_SENSITIVE_CONFIG,
      onSpanEnd: () => {},
    });
    const recordingProvider: ObservabilityProvider = {
      name: "recording",
      meter,
      tracer,
      shutdown: async () => {},
    };

    const recStack = await setupTestStack({
      features: [wiringFeature],
      systemHooks: [],
      observability: recordingProvider,
    });
    try {
      await createEntityTable(recStack.db.db, wiringEntity, "wiringWidget");
      const recTdb = createTenantDb(recStack.db.db, admin.tenantId);
      await executor.create({ name: "lag-check" }, admin, recTdb);

      await recStack.eventDispatcher?.runOnce();

      const lagGauges = metricEvents.filter(
        (e) => e.type === "gauge.set" && e.name === "kumiko_event_consumer_lag_events",
      );
      expect(lagGauges.length).toBeGreaterThan(0);
      // The cursor should be at head after a single pass: lag == 0.
      const lastPerConsumer = new Map<string, MetricEvent>();
      for (const ev of lagGauges) {
        const consumer = (ev.labels?.["consumer"] ?? "") as string;
        lastPerConsumer.set(consumer, ev);
      }
      for (const ev of lastPerConsumer.values()) {
        expect(ev.value).toBe(0);
      }
    } finally {
      await recStack.cleanup();
    }
  });
});

// --- Helpers ---

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  if (!predicate()) {
    throw new Error(`waitFor: predicate never became true within ${timeoutMs}ms`);
  }
}
