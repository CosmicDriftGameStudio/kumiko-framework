// Runde 2 / C.4 — MSP errorMode.continuous.skipApplyErrors
//
// Default (strict) behaviour: a throwing apply retries up to maxAttempts,
// then the consumer status flips to "dead" and delivery pauses. Correct for
// read-models that must stay consistent.
//
// For best-effort sinks (notifications, webhooks, metrics fan-out) a single
// bad event shouldn't stall the whole consumer. skipApplyErrors=true logs the
// error on the skip counter, advances the cursor, and keeps delivering. The
// consumer stays "idle".

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { createEventStoreExecutor } from "../../db/event-store-executor";
import { createTenantDb, type TenantDb } from "../../db/tenant-db";
import { defineFeature } from "../../engine";
import { getConsumerState } from "../../pipeline";
import { setupTestStack, type TestStack } from "../../stack";
import {
  resetEventStore,
  TestUsers,
  unsafeCreateEntityTable } from "../../stack";
import { sharedWidgetEntity, sharedWidgetTable } from "../../testing";

// --- Feature ---

const executor = createEventStoreExecutor(sharedWidgetTable, sharedWidgetEntity, {
  entityName: "widget",
});

// Two MSPs reacting to the same event type:
//   - strict: default behavior, poison event kills the consumer
//   - lenient: skipApplyErrors, poison event gets skipped, delivery continues
// Poison selector is by payload.name so each test can inject a bad event
// at a known position in the stream.
const POISON_MARKER = "poison";

const strictObserved: string[] = [];
const lenientObserved: string[] = [];

const z2Feature = defineFeature("errmode", (r) => {
  r.entity("widget", sharedWidgetEntity);

  r.multiStreamProjection({
    name: "strict",
    apply: {
      "widget.created": async (event) => {
        const name = event.payload["name"] as string;
        if (name === POISON_MARKER) throw new Error("boom-strict");
        strictObserved.push(name);
      },
    },
    // errorMode omitted → default strict
  });

  r.multiStreamProjection({
    name: "lenient",
    apply: {
      "widget.created": async (event) => {
        const name = event.payload["name"] as string;
        if (name === POISON_MARKER) throw new Error("boom-lenient");
        lenientObserved.push(name);
      },
    },
    errorMode: { continuous: { skipApplyErrors: true } },
  });
});

// --- Stack ---

let stack: TestStack;
let tdb: TenantDb;
const admin = TestUsers.admin;
const strictQn = "errmode:projection:strict";
const lenientQn = "errmode:projection:lenient";

beforeAll(async () => {
  stack = await setupTestStack({
    features: [z2Feature],
    systemHooks: [],
  });
  await unsafeCreateEntityTable(stack.db, sharedWidgetEntity, "widget");
  tdb = createTenantDb(stack.db, admin.tenantId);
});

afterAll(async () => {
  await stack.cleanup();
});

afterEach(async () => {
  strictObserved.length = 0;
  lenientObserved.length = 0;
  await resetEventStore(stack, ["read_widgets"]);
});

async function appendWidget(name: string): Promise<void> {
  await executor.create({ name }, admin, tdb);
}

// --- Tests ---

describe("Runde 2 / C.4 — MSP skipApplyErrors", () => {
  test("default strict: poison event halts the consumer, cursor stops at predecessor", async () => {
    await appendWidget("a");
    await appendWidget(POISON_MARKER);
    await appendWidget("c"); // would only be delivered AFTER the poison is resolved

    // Drive the dispatcher hard enough to exhaust maxAttempts on the poison.
    for (let i = 0; i < 15; i++) {
      await stack.eventDispatcher?.runOnce();
    }

    // Strict consumer saw "a" but nothing past it — the poison blocked it.
    expect(strictObserved).toEqual(["a"]);
    const state = await getConsumerState(stack.db, strictQn);
    expect(state?.status).toBe("dead");
    expect(state?.lastError).toMatch(/boom-strict/);
  });

  test("lenient: poison event is skipped, cursor advances, later events are delivered", async () => {
    await appendWidget("a");
    await appendWidget(POISON_MARKER);
    await appendWidget("c");

    await stack.eventDispatcher?.runOnce();

    // Lenient consumer skipped the poison and saw "c".
    expect(lenientObserved).toEqual(["a", "c"]);
    // State stays idle — no dead-letter, no retry.
    const state = await getConsumerState(stack.db, lenientQn);
    expect(state?.status).toBe("idle");
    // Cursor advanced past all three events (latest event id = 3).
    expect(state?.lastProcessedEventId).toBe(3n);
  });

  test("lenient: multiple poison events in a row all get skipped", async () => {
    await appendWidget(POISON_MARKER);
    await appendWidget(POISON_MARKER);
    await appendWidget("survivor");

    await stack.eventDispatcher?.runOnce();

    expect(lenientObserved).toEqual(["survivor"]);
    const state = await getConsumerState(stack.db, lenientQn);
    expect(state?.status).toBe("idle");
    expect(state?.lastProcessedEventId).toBe(3n);
  });
});
