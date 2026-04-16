import { eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { z } from "zod";
import { createEntity, createSystemUser, createTextField, defineFeature } from "../../engine";
import { UnprocessableError, writeFailure } from "../../errors";
import { createEntityTable, setupTestStack, type TestStack, TestUsers } from "../../testing";
import { eventOutboxTable } from "../outbox-table";

// Feature under test: a single entity whose create-handler emits an event
// inside the transaction. Tests observe both subscriber delivery AND the
// outbox row state to verify transactional semantics end-to-end.
const itemEntity = createEntity({
  table: "outbox_items",
  fields: { label: createTextField({ required: true }) },
});

// Per-test state. Reset in beforeEach.
let subscriberCalls: Array<{ type: string; payload: unknown }> = [];
let subscriberShouldFail = false;

const outboxFeature = defineFeature("outbox-test", (r) => {
  r.entity("item", itemEntity);
  r.defineEvent("item.created", z.object({ id: z.uuid(), label: z.string() }));

  // Default path: emit in tx, succeed.
  r.writeHandler(
    "item:create",
    z.object({ label: z.string(), fail: z.boolean().optional() }),
    async (event, ctx) => {
      await ctx.emit("outbox-test:event:item.created", {
        id: 1,
        label: event.payload.label,
      });
      if (event.payload.fail) {
        // Roll back after emit — proves the outbox row rolled back too.
        return writeFailure(new UnprocessableError("intentional_rollback"));
      }
      return {
        isSuccess: true,
        data: { kind: "save", id: 1, data: {}, changes: {}, previous: {}, isNew: true },
      };
    },
    { access: { roles: ["Admin"] } },
  );

  // System-scoped emit path: emits with a SYSTEM user (tenantId = 0), used to
  // verify that a system event lands in the outbox with tenant_id = null.
  r.writeHandler(
    "item:emit-system",
    z.object({ label: z.string() }),
    async (event, ctx) => {
      const system = createSystemUser("00000000-0000-4000-8000-000000000000");
      await ctx.writeAs(system, "outbox-test:write:item:emit-inner", event.payload);
      return {
        isSuccess: true,
        data: { kind: "save", id: 1, data: {}, changes: {}, previous: {}, isNew: true },
      };
    },
    { access: { roles: ["Admin"] } },
  );

  // Inner system-handler — runs as SYSTEM so ctx.emit sees user.tenantId = 0,
  // which maps to NULL in the outbox row (system-scope marker).
  r.writeHandler(
    "item:emit-inner",
    z.object({ label: z.string() }),
    async (event, ctx) => {
      await ctx.emit("outbox-test:event:item.created", {
        id: 2,
        label: event.payload.label,
      });
      return {
        isSuccess: true,
        data: { kind: "save", id: 2, data: {}, changes: {}, previous: {}, isNew: true },
      };
    },
    { access: { roles: ["system"] } },
  );
});

let stack: TestStack;
const admin = TestUsers.admin;

beforeAll(async () => {
  stack = await setupTestStack({ features: [outboxFeature], outbox: true });
  await createEntityTable(stack.db.db, itemEntity);

  // Register the in-process subscriber. dispatchLocal (used by the poller)
  // calls it synchronously — so subscriberCalls is populated the instant
  // runOnce() resolves.
  stack.eventBroker?.subscribe("outbox-test:event:item.created", async (event) => {
    if (subscriberShouldFail) throw new Error("subscriber_boom");
    subscriberCalls.push(event);
  });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  subscriberCalls = [];
  subscriberShouldFail = false;
  await stack.db.db.delete(eventOutboxTable);
  await stack.redis.redis.flushdb();
});

// Wait helper for the auto-wake-up path. Polls a (possibly async) condition
// up to `timeoutMs` so tests that exercise the background timer / Redis
// wake-up don't race.
async function waitUntil(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 500,
  intervalMs = 10,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

// ---------------------------------------------------------------------------
// Transactional emit: commit vs rollback
// ---------------------------------------------------------------------------

describe("Outbox: transactional emit", () => {
  test("successful write → outbox row inserted, poller publishes, subscriber called synchronously", async () => {
    const res = await stack.http.write("outbox-test:write:item:create", { label: "alpha" }, admin);
    expect((await res.json()).isSuccess).toBe(true);

    const rowsBefore = await stack.db.db.select().from(eventOutboxTable);
    expect(rowsBefore).toHaveLength(1);

    // Drain deterministically. dispatchLocal is synchronous inside runOnce,
    // so when the promise resolves the subscriber has already been called.
    const drain = await stack.outboxPoller?.runOnce();
    expect(drain).toEqual({ processed: 1, failed: 0 });

    const rowsAfter = await stack.db.db.select().from(eventOutboxTable);
    expect(rowsAfter[0]?.publishedAt).not.toBeNull();

    expect(subscriberCalls).toHaveLength(1);
    expect(subscriberCalls[0]).toMatchObject({
      type: "outbox-test:event:item.created",
      payload: { label: "alpha" },
    });
  });

  test("broker.publish runs AFTER the tx commits — the row is visible as published to a separate read", async () => {
    if (!stack.eventBroker) throw new Error("test stack missing eventBroker");

    // Spy on publish. At the moment it fires, a read on a separate connection
    // must see the row as already published — that proves the UPDATE
    // committed before publish() was invoked. If publish() ran inside the tx,
    // this SELECT (outside that tx, READ COMMITTED) would still see publishedAt
    // as NULL.
    const snapshots: Array<{ eventType: string; publishedAt: Date | null }> = [];
    const originalPublish = stack.eventBroker.publish.bind(stack.eventBroker);
    stack.eventBroker.publish = async (event) => {
      const rows = await stack.db.db
        .select()
        .from(eventOutboxTable)
        .where(eq(eventOutboxTable.eventType, event.type));
      snapshots.push({
        eventType: event.type,
        publishedAt: rows[0]?.publishedAt ?? null,
      });
      return originalPublish(event);
    };

    try {
      await stack.http.write("outbox-test:write:item:create", { label: "post-commit" }, admin);
      await stack.outboxPoller?.runOnce();

      expect(snapshots).toHaveLength(1);
      expect(snapshots[0]?.eventType).toBe("outbox-test:event:item.created");
      // The load-bearing assertion: publishedAt is NOT null at the moment of
      // publish(). This breaks if someone moves publish() back inside the
      // transactional block.
      expect(snapshots[0]?.publishedAt).not.toBeNull();
    } finally {
      stack.eventBroker.publish = originalPublish;
    }
  });

  test("rolled-back write → NO outbox row, NO subscriber call", async () => {
    const res = await stack.http.write(
      "outbox-test:write:item:create",
      { label: "doomed", fail: true },
      admin,
    );
    expect((await res.json()).isSuccess).toBe(false);

    const rows = await stack.db.db.select().from(eventOutboxTable);
    expect(rows).toHaveLength(0);

    // Pass the poller anyway — there should be nothing to dispatch.
    const drain = await stack.outboxPoller?.runOnce();
    expect(drain).toEqual({ processed: 0, failed: 0 });
    expect(subscriberCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Retry + dead-letter
// ---------------------------------------------------------------------------

describe("Outbox: retry + dead-letter", () => {
  test("subscriber keeps failing → row accumulates attempts, eventually dead-letter", async () => {
    subscriberShouldFail = true;
    await stack.http.write("outbox-test:write:item:create", { label: "beta" }, admin);

    // maxAttempts is 3 in test-stack. Each pass bumps attempts by one; the
    // 3rd pass flips deadLetter = true.
    await stack.outboxPoller?.runOnce();
    let [row] = await stack.db.db.select().from(eventOutboxTable);
    expect(row?.attempts).toBe(1);
    expect(row?.deadLetter).toBe(false);

    await stack.outboxPoller?.runOnce();
    [row] = await stack.db.db.select().from(eventOutboxTable);
    expect(row?.attempts).toBe(2);
    expect(row?.deadLetter).toBe(false);

    await stack.outboxPoller?.runOnce();
    [row] = await stack.db.db.select().from(eventOutboxTable);
    expect(row?.attempts).toBe(3);
    expect(row?.deadLetter).toBe(true);
    expect(row?.lastError).toContain("subscriber_boom");

    // After dead-letter, subsequent passes skip this row entirely.
    const drain = await stack.outboxPoller?.runOnce();
    expect(drain).toEqual({ processed: 0, failed: 0 });
  });

  test("after a failure, subscriber recovering lets the next pass publish", async () => {
    subscriberShouldFail = true;
    await stack.http.write("outbox-test:write:item:create", { label: "gamma" }, admin);

    await stack.outboxPoller?.runOnce();
    let [row] = await stack.db.db.select().from(eventOutboxTable);
    expect(row?.attempts).toBe(1);
    expect(row?.publishedAt).toBeNull();

    subscriberShouldFail = false;
    await stack.outboxPoller?.runOnce();

    [row] = await stack.db.db.select().from(eventOutboxTable);
    expect(row?.publishedAt).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Ops lookup
// ---------------------------------------------------------------------------

describe("Outbox: lookup scope", () => {
  test("dead-letter rows are findable via SELECT (manual recovery)", async () => {
    subscriberShouldFail = true;
    await stack.http.write("outbox-test:write:item:create", { label: "dead" }, admin);

    for (let i = 0; i < 3; i++) await stack.outboxPoller?.runOnce();

    const deadRows = await stack.db.db
      .select()
      .from(eventOutboxTable)
      .where(eq(eventOutboxTable.deadLetter, true));
    expect(deadRows).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Dead-letter alerting (onDeadLetter hook)
// ---------------------------------------------------------------------------

describe("Outbox: onDeadLetter hook", () => {
  let dlStack: TestStack;
  const deadLettered: Array<{ id: number; eventType: string; attempts: number }> = [];
  let dlSubscriberShouldFail = false;

  const dlFeature = defineFeature("outbox-dl-test", (r) => {
    r.entity("dlItem", itemEntity);
    r.defineEvent("dl.bang", z.object({ label: z.string() }));
    r.writeHandler(
      "dl:emit",
      z.object({ label: z.string() }),
      async (event, ctx) => {
        await ctx.emit("outbox-dl-test:event:dl.bang", { label: event.payload.label });
        return {
          isSuccess: true,
          data: { kind: "save", id: 1, data: {}, changes: {}, previous: {}, isNew: true },
        };
      },
      { access: { roles: ["Admin"] } },
    );
  });

  beforeAll(async () => {
    dlStack = await setupTestStack({
      features: [dlFeature],
      outbox: {
        onDeadLetter: (event) => {
          deadLettered.push({
            id: event.id,
            eventType: event.eventType,
            attempts: event.attempts,
          });
        },
      },
    });
    await createEntityTable(dlStack.db.db, itemEntity, "dlItem");

    dlStack.eventBroker?.subscribe("outbox-dl-test:event:dl.bang", async () => {
      if (dlSubscriberShouldFail) throw new Error("dl_subscriber_boom");
    });
  });

  afterAll(async () => {
    await dlStack.cleanup();
  });

  test("hook fires exactly once when a row crosses maxAttempts", async () => {
    dlSubscriberShouldFail = true;
    deadLettered.length = 0;

    await dlStack.http.write("outbox-dl-test:write:dl:emit", { label: "doom" }, admin);

    // Below threshold: no hook yet
    await dlStack.outboxPoller?.runOnce();
    await dlStack.outboxPoller?.runOnce();
    expect(deadLettered).toHaveLength(0);

    // Crossing threshold: hook fires
    await dlStack.outboxPoller?.runOnce();
    expect(deadLettered).toHaveLength(1);
    expect(deadLettered[0]).toMatchObject({
      eventType: "outbox-dl-test:event:dl.bang",
      attempts: 3,
    });

    // Subsequent passes skip the row — hook must not fire again
    await dlStack.outboxPoller?.runOnce();
    await dlStack.outboxPoller?.runOnce();
    expect(deadLettered).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// System-scope events (tenantId = null)
// ---------------------------------------------------------------------------

describe("Outbox: system-scope events", () => {
  test("emit by a system user (tenantId = 0) stores NULL in the outbox row", async () => {
    await stack.http.write("outbox-test:write:item:emit-system", { label: "system-event" }, admin);

    const rows = await stack.db.db.select().from(eventOutboxTable);
    expect(rows).toHaveLength(1);
    // tenant_id column should be NULL (not 0) for system-scope events.
    expect(rows[0]?.tenantId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Automatic wake-up (background delivery without runOnce)
// ---------------------------------------------------------------------------

describe("Outbox: automatic delivery", () => {
  test("Redis wake-up triggers the poller without an explicit runOnce", async () => {
    // Start the poller's background loop. Cleanup after the test.
    await stack.outboxPoller?.start();
    try {
      await stack.http.write("outbox-test:write:item:create", { label: "auto" }, admin);

      // Either the wake-up callback or the 50ms timer will drive runOnce.
      await waitUntil(() => subscriberCalls.length > 0, 1000);
      expect(subscriberCalls).toHaveLength(1);
      expect(subscriberCalls[0]?.payload).toMatchObject({ label: "auto" });
    } finally {
      await stack.outboxPoller?.stop();
    }
  });

  test("timer fallback: even without a wake-up publish, a row left in the outbox gets picked up", async () => {
    // Insert an outbox row directly — no redis.publish wake-up happens.
    // The poller's 50ms timer must notice and drain it.
    await stack.db.db.insert(eventOutboxTable).values({
      tenantId: "00000000-0000-4000-8000-000000000001",
      eventType: "outbox-test:event:item.created",
      payload: { id: 42, label: "timer" },
    });

    await stack.outboxPoller?.start();
    try {
      await waitUntil(async () => {
        const [row] = await stack.db.db
          .select()
          .from(eventOutboxTable)
          .where(isNull(eventOutboxTable.publishedAt));
        return row === undefined;
      }, 1000);

      const [row] = await stack.db.db.select().from(eventOutboxTable);
      expect(row?.publishedAt).not.toBeNull();
      expect(subscriberCalls.map((c) => c.payload)).toContainEqual({ id: 42, label: "timer" });
    } finally {
      await stack.outboxPoller?.stop();
    }
  });
});
