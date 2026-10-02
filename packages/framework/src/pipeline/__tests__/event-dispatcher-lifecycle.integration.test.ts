// Dispatcher lifecycle + observability pins:
//
//   1. buildServer returns a live eventDispatcher when consumers are wired.
//   2. dispatcher.start() delivers without explicit runOnce; a handler
//      slower than pollIntervalMs doesn't queue overlapping passes
//      (per-consumer in-flight guard).
//   3. kumiko_event_consumer_lag_events is emitted per pass.
//
// History: this file originally also tested r.postEvent's tenant-scoped
// ctx.db wrap (E.1 "wiring"). Those tests were removed with r.postEvent in
// E.2 — MSP apply runs against a raw DbRunner and propagates event.tenantId
// via payload, not via a wrapped DB handle. Tenant-isolation-via-MSP is
// tested in multi-stream-projection.integration.ts.

import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { createEventStoreExecutor } from "../../db/event-store-executor.js";
import { createTenantDb, type TenantDb } from "../../db/tenant-db.js";
import { defineFeature } from "../../engine/index.js";
import type { StoredEvent } from "../../event-store/index.js";
import {
  DEFAULT_SENSITIVE_CONFIG,
  type MetricEvent,
  type ObservabilityProvider,
  RecordingMeter,
  RecordingTracer,
} from "../../observability/index.js";
import {
  resetEventStore,
  setupTestStack,
  type TestStack,
  TestUsers,
  unsafeCreateEntityTable,
} from "../../stack/index.js";
import { sharedWidgetEntity, sharedWidgetTable, waitFor } from "../../testing/index.js";

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
// slow-handler / in-flight guard test.
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
      await waitFor(() => observations.length >= 1, { delays: Array(40).fill(50) });
      expect(observations).toHaveLength(1);
      expect(observations[0]?.event.payload["name"]).toBe("started-delivery");
    } finally {
      await stack.eventDispatcher?.stop();
    }
  });

  test("slow handler doesn't queue overlapping passes (per-consumer in-flight guard)", async () => {
    // 250ms handler >> 50ms pollIntervalMs — without the in-flight guard, the
    // setInterval would start a new pass every 50ms on top of the one in
    // flight. The guard must coalesce them. We verify: no two passes
    // ran concurrently.
    slowHandlerDelayMs = 250;

    await stack.eventDispatcher?.start();
    try {
      await appendWidget("slow-1");
      await appendWidget("slow-2");
      await appendWidget("slow-3");

      // Wait until all 3 slow-observer invocations have completed.
      await waitFor(() => slowHandlerInvocations.length >= 3, { delays: Array(50).fill(100) });

      // Check: no invocation overlapped with the next — every pass
      // finished before the following one started. The guard does
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

describe("drain", () => {
  test("waits for a pass still in its idle pre-check, before any consumer turn is registered", async () => {
    await stack.eventDispatcher?.ensureRegistered();
    await appendWidget("drain-me");

    // Not awaited: the pass is suspended in the idle pre-check query when
    // drain() is called, so no consumer turn is in flight yet.
    const pass = stack.eventDispatcher?.runOnce();
    await stack.eventDispatcher?.drain();

    expect(observations).toHaveLength(1);
    await pass;
  });

  test("waits for a slow in-flight consumer turn, then leaves the dispatcher running", async () => {
    slowHandlerDelayMs = 300;
    await stack.eventDispatcher?.start();
    try {
      await appendWidget("in-flight");
      await waitFor(() => observations.length >= 1, { delays: Array(40).fill(50) });

      await stack.eventDispatcher?.drain();
      expect(slowHandlerInvocations).toHaveLength(1);

      // No second start(): drain() must keep the timer / LISTEN wake-up alive.
      slowHandlerDelayMs = 0;
      await appendWidget("after-drain");
      await waitFor(() => observations.length >= 2, { delays: Array(40).fill(50) });
      expect(observations[1]?.event.payload["name"]).toBe("after-drain");
    } finally {
      await stack.eventDispatcher?.stop();
    }
  });

  test("without a started dispatcher and nothing in flight it is a no-op that starts no pass", async () => {
    await stack.eventDispatcher?.ensureRegistered();
    await appendWidget("not-delivered");

    await stack.eventDispatcher?.drain();

    expect(observations).toHaveLength(0);
  });
});

describe("withBackgroundPassesPaused", () => {
  test("timer and NOTIFY start no pass while paused, delivery resumes afterwards", async () => {
    await stack.eventDispatcher?.start();
    try {
      await stack.eventDispatcher?.withBackgroundPassesPaused(async () => {
        await appendWidget("while-paused");
        // pollIntervalMs is 50ms: several ticks plus the NOTIFY pass by.
        await new Promise((resolve) => setTimeout(resolve, 300));
        expect(observations).toHaveLength(0);
      });

      await waitFor(() => observations.length >= 1, { delays: Array(40).fill(50) });
      expect(observations[0]?.event.payload["name"]).toBe("while-paused");
    } finally {
      await stack.eventDispatcher?.stop();
    }
  });

  test("resetEventStore on a running dispatcher leaves consumers registered and no foreign rows", async () => {
    await stack.eventDispatcher?.start();
    try {
      for (let i = 0; i < 5; i++) {
        await appendWidget(`cycle-${i}`);
        await resetEventStore(stack, ["read_widgets"]);
      }
      await appendWidget("after-cycles");
      await stack.eventDispatcher?.runOnce();
      expect(observations.at(-1)?.event.payload["name"]).toBe("after-cycles");
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
