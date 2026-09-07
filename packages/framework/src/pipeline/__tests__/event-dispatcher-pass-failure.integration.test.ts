// kumiko-framework#2616 — processConsumer's db.begin rolled back the WHOLE
// pass (including markProcessing/persistConsumerOutcome) whenever anything
// inside it threw AFTER delivery succeeded, silently reverting attempts/
// last_error/cursor to their pre-pass values. Combined with `context.log?.`,
// a process without a logger lost the error entirely — in prod this looked
// like a healthy consumer (status=idle, attempts=0, last_error=NULL) that
// was actually looping at 24 rollbacks/sec.
//
// The real prod trigger was never identified (see the issue), so this test
// reproduces the SHAPE of the bug via a legitimate fault-injection point
// instead of the unknown original cause: EventDispatcherOptions.meter is
// dependency-injected, and emitLagFromTx (called INSIDE the same db.begin,
// after delivery+persistConsumerOutcome already ran) is where a thrown
// metric emission rolls back an otherwise-successful pass. No production
// code is touched to make this reproducible.

import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { createEventStoreExecutor } from "../../db/event-store-executor";
import { asRawClient } from "../../db/query";
import { createTenantDb, type TenantDb } from "../../db/tenant-db";
import { defineFeature } from "../../engine";
import { type Gauge, getFallbackMeter, type Meter } from "../../observability";
import {
  createEventDispatcher,
  type EventConsumer,
  type EventDispatcher,
  getConsumerState,
} from "../../pipeline";
import {
  resetEventStore,
  setupTestStack,
  type TestStack,
  TestUsers,
  unsafeCreateEntityTable,
} from "../../stack";
import { sharedWidgetEntity, sharedWidgetTable } from "../../testing";

const executor = createEventStoreExecutor(sharedWidgetTable, sharedWidgetEntity, {
  entityName: "widget",
});

const feature = defineFeature("passfailure", (r) => {
  r.entity("widget", sharedWidgetEntity);
});

const admin = TestUsers.admin;
let stack: TestStack;
let tdb: TenantDb;

beforeAll(async () => {
  stack = await setupTestStack({ features: [feature], systemHooks: [] });
  await unsafeCreateEntityTable(stack.db, sharedWidgetEntity, "widget");
  tdb = createTenantDb(stack.db, admin.tenantId);
});

afterEach(async () => {
  await resetEventStore(stack, ["read_widgets"]);
});

async function appendWidget(name: string): Promise<void> {
  await executor.create({ name }, admin, tdb);
}

// A meter that throws on the lag-gauge emission for one specific consumer —
// the same injection point prod's unidentified exception would have hit,
// since emitLagFromTx runs last inside processConsumer's db.begin.
function makeLagFailingMeter(shouldFail: (consumer: string) => boolean): Meter {
  const base = getFallbackMeter();
  return {
    registerMetric: (def) => base.registerMetric(def),
    counter: (name) => base.counter(name),
    histogram: (name) => base.histogram(name),
    gauge: (name): Gauge => {
      const real = base.gauge(name);
      if (name !== "kumiko_event_consumer_lag_events") return real;
      return {
        set: (value, labels) => {
          const consumer = String(labels?.["consumer"] ?? "");
          if (shouldFail(consumer)) {
            throw new Error(`injected-lag-failure-for-${consumer}`);
          }
          real.set(value, labels);
        },
        inc: (value, labels) => real.inc(value, labels),
        dec: (value, labels) => real.dec(value, labels),
      };
    },
    definitions: () => base.definitions(),
  };
}

function buildDispatcher(consumers: readonly EventConsumer[], meter: Meter): EventDispatcher {
  return createEventDispatcher({
    db: stack.db,
    consumers,
    // Deliberately no `log` field — proves the console.error fallback, not
    // the pre-existing context.log?.error(...) path.
    context: { db: stack.db, redis: stack.redis.redis, registry: stack.registry },
    meter,
    batchSize: 200,
    pollIntervalMs: 5000,
  });
}

describe("event-dispatcher — pass-level throw survives the rolled-back tx (#2616)", () => {
  test("logs via console.error when context.log is absent", async () => {
    const flaky = "passfailure:flaky-log";
    const consumer: EventConsumer = { name: flaky, handler: async () => {} };
    const dispatcher = buildDispatcher(
      [consumer],
      makeLagFailingMeter((c) => c === flaky),
    );
    await dispatcher.ensureRegistered();
    await appendWidget("one");

    const originalError = console.error;
    const logged: string[] = [];
    console.error = (...args: unknown[]) => {
      logged.push(args.map(String).join(" "));
    };
    try {
      await dispatcher.runOnce();
    } finally {
      console.error = originalError;
    }

    expect(logged.some((l) => l.includes(flaky) && l.includes("injected-lag-failure"))).toBe(true);
  });

  test("last_error survives the rollback while attempts stays untouched", async () => {
    const flaky = "passfailure:attempts";
    const consumer: EventConsumer = { name: flaky, handler: async () => {} };
    const dispatcher = buildDispatcher(
      [consumer],
      makeLagFailingMeter((c) => c === flaky),
    );
    await dispatcher.ensureRegistered();
    await appendWidget("one");

    const before = await getConsumerState(stack.db, flaky);
    expect(before?.attempts).toBe(0);
    expect(before?.lastError).toBeNull();

    await dispatcher.runOnce();

    const after = await getConsumerState(stack.db, flaky);
    // Delivery itself succeeded (the handler never threw) — only the lag
    // emission did, rolling back markProcessing/persistConsumerOutcome. The
    // dedicated post-catch write in its own transaction lands last_error,
    // but must NOT touch attempts: that counter is deliverEvents' dead-letter
    // budget, and this is an infra-level pass failure, not a handler throw.
    expect(after?.attempts).toBe(0);
    expect(after?.lastError).toMatch(/injected-lag-failure/);
    // The cursor update rolled back with the rest of the transaction — the
    // consumer will redeliver "one" once its backoff clears.
    expect(after?.lastProcessedEventId).toBe(0n);
  });

  test("backs off after a thrown pass instead of retrying every tick, other consumers unaffected", async () => {
    const flaky = "passfailure:backoff";
    const healthy = "passfailure:healthy";
    const healthySeen: string[] = [];

    const flakyConsumer: EventConsumer = { name: flaky, handler: async () => {} };
    const healthyConsumer: EventConsumer = {
      name: healthy,
      handler: async (event) => {
        healthySeen.push(String(event.payload["name"]));
      },
    };
    const dispatcher = buildDispatcher(
      [flakyConsumer, healthyConsumer],
      makeLagFailingMeter((c) => c === flaky),
    );
    await dispatcher.ensureRegistered();
    await appendWidget("first");

    await dispatcher.runOnce();
    const afterFirst = await getConsumerState(stack.db, flaky);
    expect(afterFirst?.attempts).toBe(0);
    expect(afterFirst?.lastProcessedEventId).toBe(0n);

    // Retry on the very next tick: the backoff must skip the flaky consumer
    // (no delivery attempt, so no change to attempts) while the healthy one
    // keeps advancing.
    await appendWidget("second-for-healthy");
    const second = await dispatcher.runOnce();
    const afterSecond = await getConsumerState(stack.db, flaky);
    expect(afterSecond?.attempts).toBe(0);
    expect(healthySeen).toEqual(["first", "second-for-healthy"]);
    expect(second.byConsumer[healthy]?.processed).toBeGreaterThan(0);
  });

  test("a successful pass clears the backoff so a later failure isn't skipped", async () => {
    const name = "passfailure:recovers";
    let failOnce = true;
    const consumer: EventConsumer = { name, handler: async () => {} };
    const meter = makeLagFailingMeter((c) => {
      if (c === name && failOnce) {
        failOnce = false;
        return true;
      }
      return false;
    });

    const dispatcher = buildDispatcher([consumer], meter);
    await dispatcher.ensureRegistered();
    await appendWidget("one");

    await dispatcher.runOnce();
    const afterFailure = await getConsumerState(stack.db, name);
    expect(afterFailure?.attempts).toBe(0);
    expect(afterFailure?.lastProcessedEventId).toBe(0n);

    // Wait out the (short, base-case) backoff window rather than reaching
    // into dispatcher internals.
    await new Promise((r) => setTimeout(r, 1100));
    await dispatcher.runOnce();

    const afterSuccess = await getConsumerState(stack.db, name);
    expect(afterSuccess?.status).toBe("idle");
    expect(afterSuccess?.attempts).toBe(0);
    expect(afterSuccess?.lastProcessedEventId).toBe(1n);

    // A fresh failure right after the successful pass must NOT be skipped —
    // proves the backoff entry was cleared, not left at its escalated delay.
    // attempts stays at 0: this is the same infra-level pass failure as
    // above, which never touches deliverEvents' dead-letter budget.
    failOnce = true;
    await appendWidget("two");
    await dispatcher.runOnce();
    const afterSecondFailure = await getConsumerState(stack.db, name);
    expect(afterSecondFailure?.attempts).toBe(0);
  });

  test("repeated infra-level pass failures never spend deliverEvents' dead-letter budget", async () => {
    const flaky = "passfailure:budget";
    const consumer: EventConsumer = { name: flaky, handler: async () => {} };
    const meter = makeLagFailingMeter((c) => c === flaky);
    await buildDispatcher([consumer], meter).ensureRegistered();

    // Seed as if 9 of the real deliverEvents budget (maxAttempts=10) were
    // already spent on genuine handler throws.
    await asRawClient(stack.db).unsafe(
      `UPDATE "kumiko_event_consumers" SET "attempts" = 9 WHERE "name" = $1`,
      [flaky],
    );
    await appendWidget("one");

    // Three infra-level pass failures in a row. Each uses a fresh dispatcher
    // instance so its in-memory backoff never delays the next runOnce() —
    // the DB row (and its seeded attempts=9) is what's shared and under test.
    for (let i = 0; i < 3; i++) {
      const dispatcher = buildDispatcher([consumer], meter);
      await dispatcher.ensureRegistered();
      await dispatcher.runOnce();
    }

    const after = await getConsumerState(stack.db, flaky);
    // A 10th genuine handler throw would now dead-letter the consumer if
    // these infra failures had bumped attempts past the seeded 9 — they
    // must not, since none of them ran a real delivery pass.
    expect(after?.attempts).toBe(9);
    expect(after?.status).not.toBe("dead");
  });
});
