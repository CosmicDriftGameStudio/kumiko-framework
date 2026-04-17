// Second-audit fixes — three latent silent-broken behaviours in the async
// event-dispatcher that only surface when specific call-sites materialise.
// Pinned here so regressions fail loudly:
//
//   1. SYSTEM_TENANT_ID event delivered to a non-systemScoped subscriber used
//      to be wrapped in `createTenantDb(baseDb, SYSTEM_TENANT_ID)`, which
//      silently restricts reads to reference data (tenantId=ZERO) and
//      rejects every write. The fix: treat SYSTEM_TENANT_ID like
//      systemScoped — raw baseDb.
//
//   2. Prune-vs-new-consumer race. Before the fix, a fresh deploy that
//      adds a r.postEvent subscriber + simultaneously runs prune could
//      silently delete events before the new consumer ever saw them. Two
//      pieces close this: (a) pre-registering every consumer row on
//      dispatcher.start() so the retention guard sees it, (b) a
//      SHARE-mode table lock in pruneEvents as defence-in-depth.
//
//   3. LISTEN-subscription health is now emitted as a gauge
//      (kumiko_event_dispatcher_listen_connected). Ops can see the
//      moment delivery latency regresses from TCP-round-trip to
//      pollIntervalMs.

import { eq, sql } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, test } from "vitest";
import { createEventStoreExecutor } from "../../db/event-store-executor";
import { createTenantDb, type TenantDb } from "../../db/tenant-db";
import { defineFeature, SYSTEM_TENANT_ID } from "../../engine";
import { eventsTable } from "../../event-store";
import {
  DEFAULT_SENSITIVE_CONFIG,
  type MetricEvent,
  type ObservabilityProvider,
  RecordingMeter,
  RecordingTracer,
} from "../../observability";
import {
  ConsumerLagError,
  eventConsumerStateTable,
  PUBSUB_AGGREGATE_TYPE,
  pruneEvents,
} from "../../pipeline";
import {
  createEntityTable,
  setupTestStack,
  sharedWidgetEntity,
  sharedWidgetTable,
  type TestStack,
  TestUsers,
} from "../../testing";

// --- Fixture ---

const executor = createEventStoreExecutor(sharedWidgetTable, sharedWidgetEntity, {
  entityName: "widget",
});

// Capture ctx.db for each post-event call so tests can assert on the shape
// of the db handle the subscriber received.
type DbSnapshot = { readonly tenantId?: unknown; readonly mode?: unknown; readonly raw?: unknown };
let tenantScopedDb: DbSnapshot | null = null;
let systemScopedDb: DbSnapshot | null = null;

const auditFeature = defineFeature("audit", (r) => {
  r.entity("widget", sharedWidgetEntity);

  // Default (tenant-wrapped) subscriber. The SYSTEM_TENANT_ID fix matters
  // exactly for this flavour — without it, a SYSTEM_TENANT_ID event would
  // silently bind this handler's db to reference-data-only.
  r.postEvent("default-scope", async (_event, ctx) => {
    tenantScopedDb = ctx.db as DbSnapshot;
  });

  r.postEvent(
    "system-opt-out",
    async (_event, ctx) => {
      systemScopedDb = ctx.db as DbSnapshot;
    },
    { systemScoped: true },
  );
});

const admin = TestUsers.admin;
let stack: TestStack;
let tdb: TenantDb;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [auditFeature],
    systemHooks: [],
  });
  await createEntityTable(stack.db.db, sharedWidgetEntity, "widget");
  tdb = createTenantDb(stack.db.db, admin.tenantId);
});

afterEach(async () => {
  tenantScopedDb = null;
  systemScopedDb = null;
  await stack.db.db.execute(
    sql`TRUNCATE events, widgets, kumiko_event_consumers RESTART IDENTITY CASCADE`,
  );
});

// Insert a pub/sub event directly so we can stamp tenantId=SYSTEM_TENANT_ID
// without routing through ctx.emit (which takes the SessionUser's
// tenantId). Mirrors seedOldPubsubEvent in event-retention.integration.
async function seedZeroTenantPubsubEvent(type: string, name: string): Promise<void> {
  await stack.db.db.insert(eventsTable).values({
    aggregateId: globalThis.crypto.randomUUID(),
    aggregateType: PUBSUB_AGGREGATE_TYPE,
    tenantId: SYSTEM_TENANT_ID,
    version: 1,
    type,
    payload: { name },
    metadata: { userId: admin.id },
    createdBy: admin.id,
  });
}

async function seedOldPubsubEvent(createdAt: Date): Promise<void> {
  await stack.db.db.insert(eventsTable).values({
    aggregateId: globalThis.crypto.randomUUID(),
    aggregateType: PUBSUB_AGGREGATE_TYPE,
    tenantId: admin.tenantId,
    version: 1,
    type: "audit:event:old",
    payload: {},
    metadata: { userId: admin.id },
    createdAt,
    createdBy: admin.id,
  });
}

// --- Fix #1 — SYSTEM_TENANT_ID ---

describe("Second audit — SYSTEM_TENANT_ID + non-systemScoped subscriber", () => {
  test("event with tenantId=SYSTEM_TENANT_ID delivers raw baseDb to the default subscriber", async () => {
    // Before the fix: the default subscriber's ctx.db would be
    // createTenantDb(baseDb, SYSTEM_TENANT_ID) — a TenantDb whose readFilter
    // narrows to `tenantId = ZERO OR tenantId = ZERO` (reference-data-only)
    // and whose writeFilter rejects everything. Silent because the handler
    // would run without throwing, just with a crippled view.
    await seedZeroTenantPubsubEvent("audit:event:zero", "zero-tenant");
    await stack.eventDispatcher?.runOnce();

    // Raw DbConnection has no `.tenantId` / `.mode` / `.raw` fields; the
    // TenantDb wrapper adds all three. The presence of those fields would
    // be the bug.
    expect(tenantScopedDb).not.toBeNull();
    expect(tenantScopedDb?.tenantId).toBeUndefined();
    expect(tenantScopedDb?.mode).toBeUndefined();
    expect(tenantScopedDb?.raw).toBeUndefined();
  });

  test("event with a real tenantId still delivers a TenantDb (wrap intact for the normal path)", async () => {
    // Regression guard: the SYSTEM_TENANT_ID fix must not short-circuit the
    // tenant-wrap for real tenants. Those still need the filter — tenant
    // isolation is the reason this wrap exists.
    await executor.create({ name: "real-tenant" }, admin, tdb);
    await stack.eventDispatcher?.runOnce();

    expect(tenantScopedDb).not.toBeNull();
    expect(tenantScopedDb?.tenantId).toBe(admin.tenantId);
    expect(tenantScopedDb?.mode).toBe("tenant");
  });

  test("systemScoped subscriber always receives raw baseDb, regardless of event tenantId", async () => {
    // Baseline: systemScoped opt-out bypasses the wrap entirely. Unchanged
    // by this fix, but guarded to make sure the shortcut for
    // SYSTEM_TENANT_ID doesn't collide with systemScoped somehow.
    await seedZeroTenantPubsubEvent("audit:event:zero-system", "sys");
    await stack.eventDispatcher?.runOnce();

    expect(systemScopedDb?.tenantId).toBeUndefined();
    expect(systemScopedDb?.mode).toBeUndefined();
  });
});

// --- Fix #2 — Prune-vs-new-consumer race (pre-registration) ---

describe("Second audit — consumer pre-registration on start()", () => {
  test("start() inserts a state row for every registered consumer", async () => {
    // Before the fix, state rows were created lazily on first runOnce. A
    // deploy that brought up the process AND immediately ran prune (in a
    // separate service) could prune past a consumer that hadn't run yet.
    // Pre-registration closes that window: start() inserts, prune sees
    // every consumer at cursor=0, refuses to prune past them.
    await stack.eventDispatcher?.start();
    try {
      const rows = await stack.db.db.select().from(eventConsumerStateTable);
      const names = new Set(rows.map((r) => r.name));

      // The test-stack wires only feature subscribers (systemHooks: []),
      // so we expect the two r.postEvent entries.
      expect(names.has("audit:consumer:default-scope")).toBe(true);
      expect(names.has("audit:consumer:system-opt-out")).toBe(true);

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
    await seedOldPubsubEvent(new Date(Date.now() - 10 * 24 * 60 * 60 * 1000));

    await stack.eventDispatcher?.start();
    try {
      await expect(pruneEvents(stack.db.db, { olderThanDays: 1 })).rejects.toBeInstanceOf(
        ConsumerLagError,
      );
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
    await stack.db.db
      .update(eventConsumerStateTable)
      .set({ lastProcessedEventId: 42n })
      .where(eq(eventConsumerStateTable.name, "audit:consumer:default-scope"));

    await stack.eventDispatcher?.start();
    try {
      const [row] = await stack.db.db
        .select()
        .from(eventConsumerStateTable)
        .where(eq(eventConsumerStateTable.name, "audit:consumer:default-scope"));
      expect(row?.lastProcessedEventId).toBe(42n);
    } finally {
      await stack.eventDispatcher?.stop();
    }
  });
});

// --- Fix #3 — LISTEN observability ---

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
      await createEntityTable(recStack.db.db, sharedWidgetEntity, "widget");

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
      await createEntityTable(recStack.db.db, sharedWidgetEntity, "widget");

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
        await recStack.db.db.execute(
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
