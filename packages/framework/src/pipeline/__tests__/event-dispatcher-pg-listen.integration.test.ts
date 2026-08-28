// E.4 — PG LISTEN/NOTIFY wake-up. Without this, delivery latency is
// bounded below by pollIntervalMs. With LISTEN, event-store.append fires
// `pg_notify` on commit and any subscribed dispatcher wakes immediately.
//
// The polling timer stays as a safety net. These tests pin NOTIFY wake
// without waiting for the timer, and that start/stop still leaves LISTEN
// working. #2042: poll interval is 60s here; assert delivery inside 5s —
// if LISTEN is dead the timer cannot rescue the assertion.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createEventStoreExecutor } from "../../db/event-store-executor";
import { createTenantDb, type TenantDb } from "../../db/tenant-db";
import { defineFeature } from "../../engine";
import { setupTestStack, type TestStack, TestUsers, unsafeCreateEntityTable } from "../../stack";
import { sharedWidgetEntity, sharedWidgetTable, waitFor } from "../../testing";

// --- Fixture ---

const executor = createEventStoreExecutor(sharedWidgetTable, sharedWidgetEntity, {
  entityName: "widget",
});

let deliveryCount = 0;

const listenFeature = defineFeature("listen", (r) => {
  r.entity("widget", sharedWidgetEntity);

  r.multiStreamProjection({
    name: "latency-probe",
    apply: {
      "widget.created": async () => {
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
    // Timer effectively off — see file header (#2042). If LISTEN is
    // broken, delivery only happens via this timer, so nothing arrives
    // before the 60s mark; the tests below wait a mere 5s.
    eventDispatcherPollIntervalMs: 60_000,
  });
  await unsafeCreateEntityTable(stack.db, sharedWidgetEntity, "widget");
  tdb = createTenantDb(stack.db, admin.tenantId);
});

afterAll(async () => {
  // setupTestStack's cleanup handles eventDispatcher.stop(), which in
  // turn unlistens.
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
});
