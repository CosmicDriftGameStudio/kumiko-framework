// E.9 — Dead-Letter Recovery surface.
//
// The dispatcher halts-on-poison: repeated handler throws on the same event
// mark the consumer "dead" and pause delivery for it. Without an operational
// recovery surface, "dead" was a terminal state with only raw SQL as an
// escape hatch. These tests pin the five recovery moves:
//
//   restartConsumer  status=dead → idle, attempts=0, cursor unchanged.
//                    Dispatcher retries the failing event on the next pass.
//   disableConsumer  status=any → disabled. Dispatcher skips it entirely.
//   enableConsumer   status=disabled → idle. Delivery resumes.
//   skipPoisonEvent  advances cursor past the first event after the current
//                    cursor, resets attempts, status=idle. For events that
//                    will never succeed (broken payload, removed code).
//   (list/status are read-only; covered by event-dispatcher wiring tests.)

import { sql } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, test } from "vitest";
import { createEventStoreExecutor } from "../../db/event-store-executor";
import { createTenantDb, type TenantDb } from "../../db/tenant-db";
import { defineFeature } from "../../engine";
import {
  disableConsumer,
  enableConsumer,
  getConsumerState,
  restartConsumer,
  skipPoisonEvent,
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

// Names that make the observer throw. Reset in afterEach.
let poisonNames = new Set<string>();
let observed: Array<{ name: string }> = [];

const recoveryFeature = defineFeature("recoverytest", (r) => {
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
const qn = "recoverytest:projection:observer";
let stack: TestStack;
let tdb: TenantDb;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [recoveryFeature],
    systemHooks: [],
  });
  await createEntityTable(stack.db.db, sharedWidgetEntity, "widget");
  tdb = createTenantDb(stack.db.db, admin.tenantId);
});

afterEach(async () => {
  poisonNames = new Set();
  observed = [];
  await stack.db.db.execute(
    sql`TRUNCATE events, widgets, kumiko_event_consumers RESTART IDENTITY CASCADE`,
  );
});

async function appendWidget(name: string): Promise<void> {
  await executor.create({ name }, admin, tdb);
}

async function driveUntilDead(): Promise<void> {
  // Default maxAttempts is 10. Run enough passes to exhaust and land on dead.
  for (let i = 0; i < 10; i++) {
    await stack.eventDispatcher?.runOnce();
  }
}

// --- Tests ---

describe("E.9 — restartConsumer", () => {
  test("revives a dead consumer: status=idle, attempts=0, cursor unchanged, handler retried next pass", async () => {
    poisonNames.add("poison");
    await appendWidget("poison");
    await driveUntilDead();

    const deadState = await getConsumerState(stack.db.db, qn);
    expect(deadState?.status).toBe("dead");
    expect(deadState?.attempts).toBe(10);
    const cursorBefore = deadState?.lastProcessedEventId;

    const after = await restartConsumer(stack.db.db, qn);
    expect(after.status).toBe("idle");
    expect(after.attempts).toBe(0);
    expect(after.lastError).toBeNull();
    // Cursor unchanged — next pass retries the SAME failing event.
    expect(after.lastProcessedEventId).toBe(cursorBefore);

    // Retry still poisoned (handler still throws) — attempts climbs again.
    await stack.eventDispatcher?.runOnce();
    const afterRetry = await getConsumerState(stack.db.db, qn);
    expect(afterRetry?.attempts).toBe(1);
    expect(afterRetry?.lastError).toMatch(/poisoned: poison/);
  });

  test("refuses to restart a healthy consumer (only dead makes sense)", async () => {
    await appendWidget("clean");
    await stack.eventDispatcher?.runOnce();
    const state = await getConsumerState(stack.db.db, qn);
    expect(state?.status).toBe("idle");

    await expect(restartConsumer(stack.db.db, qn)).rejects.toThrow(/not dead/);
  });
});

describe("E.9 — disable / enable", () => {
  test("disabled consumer skips delivery even when new events arrive; enable resumes", async () => {
    await appendWidget("first");
    await stack.eventDispatcher?.runOnce();
    expect(observed.map((o) => o.name)).toEqual(["first"]);

    await disableConsumer(stack.db.db, qn);
    const disabled = await getConsumerState(stack.db.db, qn);
    expect(disabled?.status).toBe("disabled");

    await appendWidget("while-disabled");
    await stack.eventDispatcher?.runOnce();
    // Still only "first" — disabled consumer didn't pick up "while-disabled".
    expect(observed.map((o) => o.name)).toEqual(["first"]);

    await enableConsumer(stack.db.db, qn);
    const enabled = await getConsumerState(stack.db.db, qn);
    expect(enabled?.status).toBe("idle");

    await stack.eventDispatcher?.runOnce();
    expect(observed.map((o) => o.name)).toEqual(["first", "while-disabled"]);
  });

  test("enable on a non-disabled consumer throws (prevents accidental state reset)", async () => {
    await appendWidget("healthy");
    await stack.eventDispatcher?.runOnce();
    await expect(enableConsumer(stack.db.db, qn)).rejects.toThrow(/not disabled/);
  });
});

describe("E.9 — skipPoisonEvent", () => {
  test("skips past a poisoned event, advances cursor, subsequent events deliver", async () => {
    await appendWidget("before-poison");
    poisonNames.add("the-poison");
    await appendWidget("the-poison");
    poisonNames.delete("the-poison"); // no-op for current state; only matters for later retries
    await appendWidget("after-poison");

    // Restore throw-on: the handler keeps throwing on the poison name
    // until we explicitly skip it. Re-add.
    poisonNames.add("the-poison");
    await driveUntilDead();

    const beforeSkip = await getConsumerState(stack.db.db, qn);
    expect(beforeSkip?.status).toBe("dead");
    // "before-poison" was delivered successfully, so cursor sits at event 1.
    expect(beforeSkip?.lastProcessedEventId).toBe(1n);

    const skipResult = await skipPoisonEvent(stack.db.db, qn);
    expect(skipResult.status).toBe("idle");
    expect(skipResult.attempts).toBe(0);
    expect(skipResult.skippedEventId).toBe(2n);
    expect(skipResult.lastProcessedEventId).toBe(2n);

    // Now the dispatcher should pick up event 3 ("after-poison").
    await stack.eventDispatcher?.runOnce();
    expect(observed.map((o) => o.name)).toEqual(["before-poison", "after-poison"]);
  });

  test("no-op when cursor is already at events head", async () => {
    await appendWidget("only-one");
    await stack.eventDispatcher?.runOnce();
    const caught = await getConsumerState(stack.db.db, qn);
    expect(caught?.lastProcessedEventId).toBe(1n);

    const skipResult = await skipPoisonEvent(stack.db.db, qn);
    expect(skipResult.skippedEventId).toBeNull();
    // Cursor did not move.
    expect(skipResult.lastProcessedEventId).toBe(1n);
  });
});
