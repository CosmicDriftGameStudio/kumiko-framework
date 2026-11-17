// E.4 — PG LISTEN/NOTIFY wake-up. Without this, delivery latency is
// bounded below by pollIntervalMs. With LISTEN, event-store.append fires
// `pg_notify` on commit and any subscribed dispatcher wakes immediately.
//
// The polling timer stays as a safety net. These tests pin NOTIFY wake
// without waiting for the timer, and that start/stop still leaves LISTEN
// working. The poll interval is 60s here; assert delivery inside 5s —
// if LISTEN is dead the timer cannot rescue the assertion.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  sharedWidgetEntity,
  sharedWidgetTable,
  sleep,
  waitFor,
} from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { createEventStoreExecutor } from "../../db/event-store-executor.ts";
import { createTenantDb, type TenantDb } from "../../db/tenant-db.ts";
import { defineFeature } from "../../engine/index.ts";
import { TestUsers } from "../../seeding/seed-users.ts";

// --- Fixture ---

const executor = createEventStoreExecutor(sharedWidgetTable, sharedWidgetEntity, {
  entityName: "widget",
});

let deliveryCount = 0;
let gatedHandlerEntered = false;
let gate: Promise<void> | undefined;

const listenFeature = defineFeature("listen", (r) => {
  r.entity(sharedWidgetEntity);

  r.multiStreamProjection({
    name: "latency-probe",
    apply: {
      "widget.created": async (event) => {
        if (event.payload["name"] === "gated" && gate !== undefined) {
          gatedHandlerEntered = true;
          await gate;
        }
        deliveryCount += 1;
      },
    },
  });
});

const admin = TestUsers.admin;
let stack: TestStack;
let tdb: TenantDb;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [listenFeature],
    systemHooks: [],
    // Timer effectively off. If LISTEN is
    // broken, delivery only happens via this timer, so nothing arrives
    // before the 60s mark; the tests below wait a mere 5s.
    eventDispatcherPollIntervalMs: 60_000,
  });
  await unsafeCreateEntityTable(stack.db, sharedWidgetEntity, "widget");
  tdb = createTenantDb({ db: stack.db, tenantId: admin.tenantId });
});

afterAll(async () => {
  await stack.cleanup();
});

// --- Tests ---

describe("E.4 — PG NOTIFY/LISTEN wake-up", () => {
  test("NOTIFY on commit triggers runOnce without waiting for the poll timer", async () => {
    deliveryCount = 0;

    await stack.eventDispatcher?.start();
    try {
      await executor.create({ name: "latency-test" }, admin, tdb);

      await waitFor(
        () => {
          expect(deliveryCount).toBe(1);
        },
        { delays: [100, 500, 1000, 3500] },
      );
    } finally {
      await stack.eventDispatcher?.stop();
    }
  });

  test("dispatcher start/stop cycle with LISTEN attached still delivers after restart", async () => {
    // Repeated start/stop must not leak connections or break LISTEN.
    // Two start/stop cycles, then a third start() that must still wake on
    // NOTIFY — if the unlisten handle was mishandled, the subscription
    // would be stale or double-registered.
    for (let i = 0; i < 2; i++) {
      await stack.eventDispatcher?.start();
      await stack.eventDispatcher?.stop();
    }

    deliveryCount = 0;
    await stack.eventDispatcher?.start();
    try {
      await executor.create({ name: "restart-probe" }, admin, tdb);

      await waitFor(
        () => {
          expect(deliveryCount).toBe(1);
        },
        { delays: [100, 500, 1000, 3500] },
      );
    } finally {
      await stack.eventDispatcher?.stop();
    }
  });

  test("an event committed during an in-flight turn is delivered without the poll timer", async () => {
    deliveryCount = 0;
    gatedHandlerEntered = false;
    let openGate: (() => void) | undefined;
    gate = new Promise<void>((resolve) => {
      openGate = resolve;
    });

    await stack.eventDispatcher?.start();
    try {
      await executor.create({ name: "gated" }, admin, tdb);
      await waitFor(
        () => {
          expect(gatedHandlerEntered).toBe(true);
        },
        { delays: [100, 500, 1000, 3500] },
      );
      await executor.create({ name: "during-turn" }, admin, tdb);
      // Let the NOTIFY for the second event reach the dispatcher while the first turn still runs.
      await sleep(300);
      openGate?.();

      await waitFor(
        () => {
          expect(deliveryCount).toBe(2);
        },
        { delays: [100, 500, 1000, 3500] },
      );
    } finally {
      openGate?.();
      gate = undefined;
      await stack.eventDispatcher?.stop();
    }
  });

  test("an event committed while background passes are paused is delivered right after the pause", async () => {
    deliveryCount = 0;

    await stack.eventDispatcher?.start();
    try {
      await stack.eventDispatcher?.withBackgroundPassesPaused(async () => {
        await executor.create({ name: "during-pause" }, admin, tdb);
        await sleep(300);
        expect(deliveryCount).toBe(0);
      });

      await waitFor(
        () => {
          expect(deliveryCount).toBe(1);
        },
        { delays: [100, 500, 1000, 3500] },
      );
    } finally {
      await stack.eventDispatcher?.stop();
    }
  });
});
