// Second-audit fixes — two latent silent-broken behaviours in the async
// event-dispatcher that only surface when specific call-sites materialise.
// Pinned here so regressions fail loudly:
//
//   1. Prune-vs-new-consumer race. Before the fix, a fresh deploy that
//      adds a new MSP + simultaneously runs prune could silently delete
//      events before the new consumer ever saw them. Two pieces close
//      this: (a) pre-registering every consumer row on dispatcher.start()
//      so the retention guard sees it, (b) a SHARE-mode table lock in
//      pruneEvents as defence-in-depth.
//
//   2. LISTEN-subscription health is now emitted as a gauge
//      (kumiko_event_dispatcher_listen_connected). Ops can see the
//      moment delivery latency regresses from TCP-round-trip to
//      pollIntervalMs.

import { eq, sql } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, test } from "vitest";
import { defineFeature } from "../../engine";
import { eventsTable } from "../../event-store";
import {
  DEFAULT_SENSITIVE_CONFIG,
  type MetricEvent,
  type ObservabilityProvider,
  RecordingMeter,
  RecordingTracer,
} from "../../observability";
import { ConsumerLagError, eventConsumerStateTable, pruneEvents } from "../../pipeline";
import {
  createEntityTable,
  resetEventStore,
  setupTestStack,
  sharedWidgetEntity,
  type TestStack,
  TestUsers,
} from "../../testing";
import { generateId } from "../../utils";

// --- Fixture ---

const auditFeature = defineFeature("audit", (r) => {
  r.entity("widget", sharedWidgetEntity);

  // Two MSPs so the dispatcher has two consumer rows to register in the
  // pre-registration tests below. Both no-op — the tests observe the
  // kumiko_event_consumers rows, not the apply handlers.
  r.multiStreamProjection({
    name: "default-scope",
    apply: { "widget.created": async () => {} },
  });
  r.multiStreamProjection({
    name: "system-opt-out",
    apply: { "widget.created": async () => {} },
  });
});

const admin = TestUsers.admin;
let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [auditFeature],
    systemHooks: [],
  });
  await createEntityTable(stack.db, sharedWidgetEntity, "widget");
});

afterEach(async () => {
  await resetEventStore(stack, ["read_widgets"]);
});

async function seedOldWidgetEvent(createdAt: Temporal.Instant): Promise<void> {
  await stack.db.insert(eventsTable).values({
    aggregateId: generateId(),
    aggregateType: "widget",
    tenantId: admin.tenantId,
    version: 1,
    type: "widget.created",
    payload: {},
    metadata: { userId: admin.id },
    createdAt,
    createdBy: admin.id,
  });
}

// --- Fix #1 — Prune-vs-new-consumer race (pre-registration) ---

describe("Second audit — consumer pre-registration on start()", () => {
  test("start() inserts a state row for every registered consumer", async () => {
    // Before the fix, state rows were created lazily on first runOnce. A
    // deploy that brought up the process AND immediately ran prune (in a
    // separate service) could prune past a consumer that hadn't run yet.
    // Pre-registration closes that window: start() inserts, prune sees
    // every consumer at cursor=0, refuses to prune past them.
    await stack.eventDispatcher?.start();
    try {
      const rows = await stack.db.select().from(eventConsumerStateTable);
      const names = new Set(rows.map((r) => r.name));

      // The test-stack wires only feature MSP consumers (systemHooks: []),
      // so we expect the two r.multiStreamProjection entries.
      expect(names.has("audit:projection:default-scope")).toBe(true);
      expect(names.has("audit:projection:system-opt-out")).toBe(true);

      // Every pre-registered row starts at cursor 0 with status=idle.
      for (const row of rows) {
        expect(row.lastProcessedEventId).toBe(0n);
        expect(row.status).toBe("idle");
      }
    } finally {
      await stack.eventDispatcher?.stop();
    }
  });

  test("pre-registered consumer blocks prune via ConsumerLagError", async () => {
    // The integration-level guarantee: after start(), prune refuses to
    // delete events below any pre-registered consumer's cursor. This is
    // the race fix made deterministic — no Promise.all timing, just the
    // invariant the fix guarantees.
    await seedOldWidgetEvent(Temporal.Now.instant().subtract({ hours: 240 }));

    await stack.eventDispatcher?.start();
    try {
      await expect(
        pruneEvents(stack.db, { olderThanDays: 1, aggregateTypes: ["widget"] }),
      ).rejects.toBeInstanceOf(ConsumerLagError);
    } finally {
      await stack.eventDispatcher?.stop();
    }
  });

  test("start() is idempotent — two starts don't duplicate state rows", async () => {
    // ON CONFLICT DO NOTHING guarantees this. Guarded so a buildServer
    // double-start (or process-wide restart) doesn't trip unique-violation
    // or regress the cursor.
    await stack.eventDispatcher?.start();
    await stack.eventDispatcher?.stop();

    // Advance the cursor explicitly so we can prove the second start
    // doesn't clobber it back to 0.
    await stack.db
      .update(eventConsumerStateTable)
      .set({ lastProcessedEventId: 42n })
      .where(eq(eventConsumerStateTable.name, "audit:projection:default-scope"));

    await stack.eventDispatcher?.start();
    try {
      const [row] = await stack.db
        .select()
        .from(eventConsumerStateTable)
        .where(eq(eventConsumerStateTable.name, "audit:projection:default-scope"));
      expect(row?.lastProcessedEventId).toBe(42n);
    } finally {
      await stack.eventDispatcher?.stop();
    }
  });
});

// --- Fix #2 — LISTEN observability ---

describe("Second audit — LISTEN gauge", () => {
  test("kumiko_event_dispatcher_listen_connected is 1 after start() with pgClient", async () => {
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
      features: [auditFeature],
      systemHooks: [],
      observability: recordingProvider,
    });
    try {
      await createEntityTable(recStack.db, sharedWidgetEntity, "widget");

      await recStack.eventDispatcher?.start();
      try {
        // Filter for gauge.set events on the LISTEN metric. Expect the
        // sequence: 0 (start() resets) → 1 (onlisten callback fires).
        const gauges = metricEvents.filter(
          (e) => e.type === "gauge.set" && e.name === "kumiko_event_dispatcher_listen_connected",
        );
        expect(gauges.length).toBeGreaterThanOrEqual(2);
        expect(gauges[0]?.value).toBe(0);
        expect(gauges[gauges.length - 1]?.value).toBe(1);
      } finally {
        await recStack.eventDispatcher?.stop();
      }

      // After stop(), the gauge must flip back to 0 so ops can tell the
      // subscription was deliberately torn down (vs. silently dropped).
      const postStop = metricEvents
        .filter(
          (e) => e.type === "gauge.set" && e.name === "kumiko_event_dispatcher_listen_connected",
        )
        .pop();
      expect(postStop?.value).toBe(0);
    } finally {
      await recStack.cleanup();
    }
  });

  test("onlisten fires again on silent reconnect — gauge flips to 1 a second time", async () => {
    // This is the claim that justifies the onlisten-callback over a
    // simpler .set(1) after `await listen()`: on a dropped TCP, postgres.js
    // re-subscribes automatically and invokes onlisten again, and ops
    // needs to see the recovery window. Proved here by killing the
    // LISTEN backend and observing a second gauge.set(1).
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
      features: [auditFeature],
      systemHooks: [],
      observability: recordingProvider,
    });
    try {
      await createEntityTable(recStack.db, sharedWidgetEntity, "widget");

      await recStack.eventDispatcher?.start();
      try {
        const connectsWithValue1 = (): number =>
          metricEvents.filter(
            (e) =>
              e.type === "gauge.set" &&
              e.name === "kumiko_event_dispatcher_listen_connected" &&
              e.value === 1,
          ).length;

        // Wait for the initial onlisten (gauge.set 1) to land.
        await waitFor(() => connectsWithValue1() >= 1, 2000);
        const initialConnects = connectsWithValue1();
        expect(initialConnects).toBeGreaterThanOrEqual(1);

        // Terminate the LISTEN backend. postgres.js runs LISTEN on a
        // dedicated max=1 sub-pool — the backend whose last query is
        // `LISTEN "kumiko_events_new"` and is now idle. pg_terminate_backend
        // on it closes the TCP; postgres.js's onclose handler re-subscribes
        // and fires onlisten again.
        await recStack.db.execute(
          sql`SELECT pg_terminate_backend(pid) FROM pg_stat_activity
              WHERE datname = current_database()
                AND query ILIKE 'listen%'
                AND state = 'idle'
                AND pid <> pg_backend_pid()`,
        );

        // Wait for the SECOND gauge.set(1) — the reconnect. Generous timeout
        // because postgres.js's reconnect loop includes backoff.
        await waitFor(() => connectsWithValue1() > initialConnects, 10000);
        expect(connectsWithValue1()).toBeGreaterThan(initialConnects);
      } finally {
        await recStack.eventDispatcher?.stop();
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
    await new Promise((r) => setTimeout(r, 25));
  }
  if (!predicate()) {
    throw new Error(`waitFor: predicate never became true within ${timeoutMs}ms`);
  }
}
