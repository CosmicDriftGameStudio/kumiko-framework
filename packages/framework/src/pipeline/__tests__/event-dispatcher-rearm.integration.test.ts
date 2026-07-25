// Issue #1350 — bounded auto-revival of a dead consumer.
//
// acquireConsumerState no longer parks a dead consumer forever: once its
// last write is older than rearmCooldownMs it gets reset to idle and
// retried, up to maxRearmCount times. A poison event (permanent failure)
// still ends up permanently dead once the budget is exhausted — the
// mechanism is a bounded number of extra chances, not unlimited retry.

import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { createEventStoreExecutor } from "../../db/event-store-executor";
import { asRawClient } from "../../db/query";
import { createTenantDb, type TenantDb } from "../../db/tenant-db";
import { defineFeature } from "../../engine";
import {
  DEFAULT_SENSITIVE_CONFIG,
  type MetricEvent,
  type ObservabilityProvider,
  RecordingMeter,
  RecordingTracer,
} from "../../observability";
import { getConsumerState } from "../../pipeline";
import {
  resetEventStore,
  setupTestStack,
  type TestStack,
  TestUsers,
  unsafeCreateEntityTable,
} from "../../stack";
import { sharedWidgetEntity, sharedWidgetTable } from "../../testing";
import { SHARED_INSTANCE_SENTINEL } from "../event-consumer-state";

const executor = createEventStoreExecutor(sharedWidgetTable, sharedWidgetEntity, {
  entityName: "widget",
});

let poisonNames = new Set<string>();
let observed: Array<{ name: string }> = [];

const rearmFeature = defineFeature("rearmtest", (r) => {
  r.entity("widget", sharedWidgetEntity);

  r.multiStreamProjection({
    name: "observer",
    apply: {
      "widget.created": async (event) => {
        const name = event.payload["name"] as string;
        if (poisonNames.has(name)) {
          throw new Error(`poisoned: ${name}`);
        }
        observed.push({ name });
      },
    },
  });
});

const admin = TestUsers.admin;
const qn = "rearmtest:projection:observer";
let stack: TestStack;
let tdb: TenantDb;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [rearmFeature],
    systemHooks: [],
  });
  await unsafeCreateEntityTable(stack.db, sharedWidgetEntity, "widget");
  tdb = createTenantDb(stack.db, admin.tenantId);
});

afterEach(async () => {
  poisonNames = new Set();
  observed = [];
  await resetEventStore(stack, ["read_widgets"]);
});

async function appendWidget(name: string): Promise<void> {
  await executor.create({ name }, admin, tdb);
}

async function driveUntilDead(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await stack.eventDispatcher?.runOnce();
  }
}

// Simulates cooldown elapsed without waiting real wall-clock time.
async function backdateUpdatedAt(minutesAgo: number): Promise<void> {
  await asRawClient(stack.db).unsafe(
    `UPDATE "kumiko_event_consumers" SET "updated_at" = now() - make_interval(mins => $1)
     WHERE "name" = $2 AND "instance_id" = $3`,
    [minutesAgo, qn, SHARED_INSTANCE_SENTINEL],
  );
}

describe("issue #1350 — bounded dead-consumer re-arm", () => {
  test("stays dead within the cooldown window", async () => {
    poisonNames.add("poison");
    await appendWidget("poison");
    await driveUntilDead();

    const dead = await getConsumerState(stack.db, qn);
    expect(dead?.status).toBe("dead");
    expect(dead?.rearmCount).toBe(0);

    // No backdate — cooldown (5min default) hasn't elapsed.
    await stack.eventDispatcher?.runOnce();
    const stillDead = await getConsumerState(stack.db, qn);
    expect(stillDead?.status).toBe("dead");
    expect(stillDead?.rearmCount).toBe(0);
  });

  test("auto-revives once cooldown elapses, and re-dies on the same poison event", async () => {
    poisonNames.add("poison");
    await appendWidget("poison");
    await driveUntilDead();

    await backdateUpdatedAt(10);
    await stack.eventDispatcher?.runOnce();

    const revived = await getConsumerState(stack.db, qn);
    expect(revived?.status).toBe("idle");
    expect(revived?.rearmCount).toBe(1);
    // Same pass that revives it also retries the pending poisoned event —
    // acquireConsumerState's reset (attempts=0) is followed immediately by
    // one failed delivery attempt within this runOnce() call.
    expect(revived?.attempts).toBe(1);

    // Handler still throws on "poison" — climbs back to dead.
    await driveUntilDead();
    const deadAgain = await getConsumerState(stack.db, qn);
    expect(deadAgain?.status).toBe("dead");
    expect(deadAgain?.rearmCount).toBe(1);
  });

  test("a re-arm that leads to a real delivery resets rearmCount to 0", async () => {
    poisonNames.add("poison");
    await appendWidget("poison");
    await driveUntilDead();

    // Cause is gone by the time the cooldown elapses — the retried event
    // now succeeds instead of re-poisoning the consumer.
    poisonNames.delete("poison");
    await backdateUpdatedAt(10);
    await stack.eventDispatcher?.runOnce();

    const recovered = await getConsumerState(stack.db, qn);
    expect(recovered?.status).toBe("idle");
    expect(recovered?.rearmCount).toBe(0);
    expect(observed.map((o) => o.name)).toEqual(["poison"]);

    // A later, unrelated poison event gets its own fresh maxRearmCount
    // budget instead of inheriting the spent counter from the resolved one.
    poisonNames.add("later-poison");
    await appendWidget("later-poison");
    await driveUntilDead();
    const deadAgain = await getConsumerState(stack.db, qn);
    expect(deadAgain?.status).toBe("dead");
    expect(deadAgain?.rearmCount).toBe(0);
  });

  test("kumiko-framework#1525: cooldown-elapsed re-arm check works without relying on globalThis.Temporal", async () => {
    poisonNames.add("poison");
    await appendWidget("poison");
    await driveUntilDead();
    await backdateUpdatedAt(10);

    const savedGlobal = (globalThis as { Temporal?: unknown }).Temporal;
    delete (globalThis as { Temporal?: unknown }).Temporal;
    try {
      await stack.eventDispatcher?.runOnce();
    } finally {
      if (savedGlobal === undefined) delete (globalThis as { Temporal?: unknown }).Temporal;
      else (globalThis as { Temporal?: unknown }).Temporal = savedGlobal;
    }

    const revived = await getConsumerState(stack.db, qn);
    expect(revived?.status).toBe("idle");
    expect(revived?.rearmCount).toBe(1);
  });

  test("permanently dead after maxRearmCount cycles, even once cooldown elapses again", async () => {
    poisonNames.add("poison");
    await appendWidget("poison");
    await driveUntilDead();

    // Cycles 1..3: each backdate+drive re-arms once, then re-dies on the
    // same poison event. Default maxRearmCount is 3.
    for (let cycle = 1; cycle <= 3; cycle++) {
      await backdateUpdatedAt(10);
      await stack.eventDispatcher?.runOnce();
      const revived = await getConsumerState(stack.db, qn);
      expect(revived?.rearmCount).toBe(cycle);
      await driveUntilDead();
    }

    const exhausted = await getConsumerState(stack.db, qn);
    expect(exhausted?.status).toBe("dead");
    expect(exhausted?.rearmCount).toBe(3);

    // Cooldown elapsed again, but the budget is spent — stays dead.
    await backdateUpdatedAt(10);
    await stack.eventDispatcher?.runOnce();
    const stillExhausted = await getConsumerState(stack.db, qn);
    expect(stillExhausted?.status).toBe("dead");
    expect(stillExhausted?.rearmCount).toBe(3);
  });

  test("kumiko_event_consumer_rearm_exhausted_total fires once, not per still-dead pass (#1362)", async () => {
    // Dedicated stack with a RecordingMeter — module-level `stack` above is
    // shared across every test in this file and has no metric capture.
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
      features: [rearmFeature],
      systemHooks: [],
      observability: recordingProvider,
    });
    try {
      await unsafeCreateEntityTable(recStack.db, sharedWidgetEntity, "widget");
      const recTdb = createTenantDb(recStack.db, admin.tenantId);

      poisonNames.add("poison-metric");
      await executor.create({ name: "poison-metric" }, admin, recTdb);
      for (let i = 0; i < 10; i++) {
        await recStack.eventDispatcher?.runOnce();
      }
      // The 10th pass is the one whose failed delivery flips status to
      // "dead" (persisted for the NEXT pass to see) — acquireConsumerState's
      // dead-branch (where the exhausted-metric fires) only runs starting
      // from the pass AFTER that transition, same as the "stays dead within
      // cooldown window" test above needing one extra runOnce().
      await recStack.eventDispatcher?.runOnce();

      const exhaustedEvents = () =>
        metricEvents.filter(
          (e) =>
            e.type === "counter.inc" && e.name === "kumiko_event_consumer_rearm_exhausted_total",
        );
      expect(exhaustedEvents().length).toBe(1);

      // Several more passes while it's still dead — must stay at 1, not
      // re-fire on every pass that observes "still dead" (log/metric spam
      // the finding flagged).
      for (let i = 0; i < 5; i++) {
        await recStack.eventDispatcher?.runOnce();
      }
      expect(exhaustedEvents().length).toBe(1);
      expect(exhaustedEvents()[0]?.labels?.["consumer"]).toBe(qn);
    } finally {
      await resetEventStore(recStack, ["read_widgets"]);
      await recStack.cleanup();
    }
  });
});
