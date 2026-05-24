// Dispatcher lifecycle + observability pins:
//
//   1. buildServer returns a live eventDispatcher when consumers are wired.
//   2. dispatcher.start() delivers without explicit runOnce; a handler
//      slower than pollIntervalMs doesn't queue overlapping passes
//      (passInFlight serialisation).
//   3. kumiko_event_consumer_lag_events is emitted per pass.
//
// History: this file originally also tested r.postEvent's tenant-scoped
// ctx.db wrap (E.1 "wiring"). Those tests were removed with r.postEvent in
// E.2 — MSP apply runs against a raw DbRunner and propagates event.tenantId
// via payload, not via a wrapped DB handle. Tenant-isolation-via-MSP is
// tested in multi-stream-projection.integration.ts.

import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { createEventStoreExecutor } from "../../db/event-store-executor";
import { createTenantDb, type TenantDb } from "../../db/tenant-db";
import { defineFeature } from "../../engine";
import type { StoredEvent } from "../../event-store";
import {
  DEFAULT_SENSITIVE_CONFIG,
  type MetricEvent,
  type ObservabilityProvider,
  RecordingMeter,
  RecordingTracer,
} from "../../observability";
import { setupTestStack, type TestStack } from "../../stack";
import {
  resetEventStore,
  TestUsers,
  unsafeCreateEntityTable } from "../../stack";
import { sharedWidgetEntity, sharedWidgetTable } from "../../testing";

// --- Test fixtures ---

const executor = createEventStoreExecutor(sharedWidgetTable, sharedWidgetEntity, {
  entityName: "widget",
});

// Capture what the handler sees so we can assert on delivery. Reset in
// afterEach.
type Observation = {
  event: StoredEvent;
};
let observations: Observation[] = [];
// A handler that sleeps a controllable amount of time. Drives the
// slow-handler / passInFlight test.
let slowHandlerDelayMs = 0;
let slowHandlerInvocations: Array<{ start: number; end: number }> = [];

const wiringFeature = defineFeature("wiring", (r) => {
  r.entity("widget", sharedWidgetEntity);

  r.multiStreamProjection({
    name: "observer",
    apply: {
      "widget.created": async (event) => {
        observations.push({ event });
      },
    },
  });

  r.multiStreamProjection({
    name: "slow-observer",
    apply: {
      "widget.created": async () => {
        const start = Date.now();
        if (slowHandlerDelayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, slowHandlerDelayMs));
        }
        slowHandlerInvocations.push({ start, end: Date.now() });
      },
    },
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
  await unsafeCreateEntityTable(stack.db, sharedWidgetEntity, "widget");
  tdb = createTenantDb(stack.db, admin.tenantId);
});

afterEach(async () => {
  observations = [];
  slowHandlerDelayMs = 0;
  slowHandlerInvocations = [];
  await resetEventStore(stack, ["read_widgets"]);
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
});

describe("E.1 — .start() lifecycle + slow handler", () => {
  test("started dispatcher delivers events without an explicit runOnce", async () => {
    await stack.eventDispatcher?.start();
    try {
      await appendWidget("started-delivery");

      // pollIntervalMs in the test-stack is 50ms. Give the timer a few
      // ticks to observe the event.
      await waitFor(() => observations.length >= 1, 2000);
      expect(observations).toHaveLength(1);
      expect(observations[0]?.event.payload["name"]).toBe("started-delivery");
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
      await unsafeCreateEntityTable(recStack.db, sharedWidgetEntity, "widget");
      const recTdb = createTenantDb(recStack.db, admin.tenantId);
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
