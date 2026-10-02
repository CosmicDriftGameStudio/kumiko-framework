// A provably-idle consumer's doPass turn must not take the state row's
// FOR UPDATE SKIP LOCKED lock: that lock sets xmax on the row, requires an
// xid, writes WAL, and forces a commit fsync — on every poll tick, forever,
// even with zero events in the system. The pre-check in
// selectIdleConsumerKeys (event-dispatcher-delivery.ts) must keep an idle
// consumer's row untouched entirely, verified here via the row's own
// system column `xmax`: unchanged across an idle runOnce() means no lock
// was ever taken on it.

import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { createEventStoreExecutor } from "../../db/event-store-executor.js";
import { asRawClient } from "../../db/query.js";
import { createTenantDb, type TenantDb } from "../../db/tenant-db.js";
import { defineFeature } from "../../engine/index.js";
import type { StoredEvent } from "../../event-store/index.js";
import type { Logger } from "../../logging/types.js";
import {
  type MetricEvent,
  RecordingMeter,
  registerStandardMetrics,
} from "../../observability/index.js";
import {
  resetEventStore,
  setupTestStack,
  type TestStack,
  TestUsers,
  unsafeCreateEntityTable,
} from "../../stack/index.js";
import { sharedWidgetEntity, sharedWidgetTable } from "../../testing/index.js";
import { SHARED_INSTANCE_SENTINEL } from "../event-consumer-state.js";
import { createEventDispatcher, type EventConsumer } from "../event-dispatcher.js";

const executor = createEventStoreExecutor(sharedWidgetTable, sharedWidgetEntity, {
  entityName: "widget",
});

let observed: Array<{ name: string }> = [];

const idleFeature = defineFeature("idletest", (r) => {
  r.entity("widget", sharedWidgetEntity);

  r.multiStreamProjection({
    name: "observer",
    apply: {
      "widget.created": async (event) => {
        observed.push({ name: event.payload["name"] as string });
      },
    },
  });
});

const admin = TestUsers.admin;
const qn = "idletest:projection:observer";
let stack: TestStack;
let tdb: TenantDb;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [idleFeature],
    systemHooks: [],
  });
  await unsafeCreateEntityTable(stack.db, sharedWidgetEntity, "widget");
  tdb = createTenantDb(stack.db, admin.tenantId);
});

afterEach(async () => {
  observed = [];
  await resetEventStore(stack, ["read_widgets"]);
});

async function appendWidget(name: string): Promise<void> {
  await executor.create({ name }, admin, tdb);
}

async function readConsumerRowXmax(): Promise<string> {
  const rows = (await asRawClient(stack.db).unsafe(
    `SELECT xmax::text FROM "kumiko_event_consumers" WHERE "name" = $1 AND "instance_id" = $2`,
    [qn, SHARED_INSTANCE_SENTINEL],
  )) as ReadonlyArray<{ xmax: string }>;
  const xmax = rows[0]?.xmax;
  if (xmax === undefined) throw new Error("consumer state row missing");
  return xmax;
}

describe("idle event-dispatcher passes take no row lock", () => {
  test("xmax is unchanged across an idle runOnce() after draining, then a new event is still delivered", async () => {
    await appendWidget("drain-me");
    await stack.eventDispatcher?.runOnce();
    expect(observed).toEqual([{ name: "drain-me" }]);

    const xmaxBeforeIdlePass = await readConsumerRowXmax();

    await stack.eventDispatcher?.runOnce();
    const xmaxAfterIdlePass = await readConsumerRowXmax();
    expect(xmaxAfterIdlePass).toBe(xmaxBeforeIdlePass);

    await appendWidget("wake-me");
    const result = await stack.eventDispatcher?.runOnce();
    expect(result?.processed).toBeGreaterThan(0);
    expect(observed).toEqual([{ name: "drain-me" }, { name: "wake-me" }]);
  });
});

describe("idle-gated turns stay observable", () => {
  test("an idle pass counts a skipped turn per consumer instead of opening a span", async () => {
    const metricEvents: MetricEvent[] = [];
    const meter = new RecordingMeter((e) => metricEvents.push(e));
    registerStandardMetrics(meter);
    const dispatcher = createEventDispatcher({
      db: stack.db,
      consumers: [{ name: "idletest:skip-counter", handler: async () => {} }],
      context: { db: stack.db },
      meter,
    });
    await dispatcher.ensureRegistered();
    const skipped = (): MetricEvent[] =>
      metricEvents.filter(
        (e) => e.type === "counter.inc" && e.name === "kumiko_event_consumer_pass_skipped_total",
      );

    await dispatcher.runOnce();
    expect(skipped()).toHaveLength(1);
    expect(skipped()[0]?.labels).toMatchObject({
      consumer: "idletest:skip-counter",
      reason: "idle",
    });

    await appendWidget("wake");
    await dispatcher.runOnce();
    expect(skipped()).toHaveLength(1);
  });
});

function recordingLogger(): Logger & { readonly errors: string[] } {
  const errors: string[] = [];
  const logger: Logger & { errors: string[] } = {
    errors,
    info: () => {},
    warn: () => {},
    error: (msg) => errors.push(msg),
    debug: () => {},
    child: () => logger,
  };
  return logger;
}

// Fails only the idle pre-check query (the one zipping name/instance arrays via unnest);
// every other statement reaches the real database.
function dbWithFailingIdlePreCheck(
  db: TestStack["db"],
  shouldFail: () => boolean,
): TestStack["db"] {
  return new Proxy(db, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target);
      if (typeof value !== "function") return value;
      if (prop !== "unsafe") return value.bind(target);
      return (sql: string, params?: readonly unknown[]) => {
        if (shouldFail() && sql.includes("unnest")) {
          return Promise.reject(new Error("simulated idle pre-check blip"));
        }
        return value.call(target, sql, params);
      };
    },
  });
}

describe("idle pre-check failure falls back to per-consumer locking", () => {
  test("still delivers, logs once per outage, and logs again after a recovery", async () => {
    let preCheckFails = true;
    const delivered: string[] = [];
    const consumer: EventConsumer = {
      name: "idletest:precheck-fallback",
      handler: async (event: StoredEvent) => {
        delivered.push(String(event.payload["name"]));
      },
    };
    const logger = recordingLogger();
    const dispatcher = createEventDispatcher({
      db: dbWithFailingIdlePreCheck(stack.db, () => preCheckFails),
      consumers: [consumer],
      context: { db: stack.db, log: logger },
    });
    await dispatcher.ensureRegistered();
    const preCheckErrors = (): number =>
      logger.errors.filter((line) => line.includes("idle pre-check failed")).length;

    await appendWidget("during-blip");
    await dispatcher.runOnce();
    expect(delivered).toEqual(["during-blip"]);
    expect(preCheckErrors()).toBe(1);

    await dispatcher.runOnce();
    await dispatcher.runOnce();
    expect(preCheckErrors()).toBe(1);

    preCheckFails = false;
    await dispatcher.runOnce();
    preCheckFails = true;
    await dispatcher.runOnce();
    expect(preCheckErrors()).toBe(2);
  });
});
