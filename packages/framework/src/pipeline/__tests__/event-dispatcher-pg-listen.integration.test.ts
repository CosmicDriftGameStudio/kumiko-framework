// E.4 — PG LISTEN/NOTIFY wake-up. Without this, delivery latency is
// bounded below by pollIntervalMs. With LISTEN, event-store.append fires
// `pg_notify` on commit and any subscribed dispatcher wakes immediately —
// latency becomes TCP round-trip, typically sub-millisecond on localhost.
//
// The polling timer stays on as a safety net for dropped subscriptions
// and crashes between commit and wake. These tests pin:
//
//   1. NOTIFY → runOnce fires promptly, without waiting for the timer.
//   2. The dispatcher starts cleanly when pgClient is wired and stops
//      without leaking the LISTEN connection, and still wakes on NOTIFY
//      after a restart cycle.
//
// #2042: these used to assert an absolute millisecond latency bound
// (`< 40`, later `< 100`) against the test-stack's default 50ms polling
// timer. On a shared CI runner a stalled event loop can push even a
// working LISTEN's delivery past 100ms — measured up to 154ms — so no
// millisecond bound both clears runner noise and stays under a 50ms
// timer. Fix: push the polling timer out to 60s for this stack
// (`eventDispatcherPollIntervalMs`) and assert delivery happens at all
// inside a 5s window. If LISTEN is dead, nothing arrives before the 5s
// deadline — a 12x margin under the 60s timer that no runner stall gets
// anywhere near. If LISTEN works, delivery is near-instant regardless of
// runner load. Verified by temporarily forcing pgClient to undefined in
// test-stack.ts: both tests then fail at toHaveLength(1) with 0 received
// after ~5s, confirming the assertion still discriminates.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createEventStoreExecutor } from "../../db/event-store-executor";
import { createTenantDb, type TenantDb } from "../../db/tenant-db";
import { defineFeature } from "../../engine";
import { setupTestStack, type TestStack, TestUsers, unsafeCreateEntityTable } from "../../stack";
import { sharedWidgetEntity, sharedWidgetTable } from "../../testing";

// --- Fixture ---

const executor = createEventStoreExecutor(sharedWidgetTable, sharedWidgetEntity, {
  entityName: "widget",
});

const deliveryTimes: number[] = [];

const listenFeature = defineFeature("listen", (r) => {
  r.entity("widget", sharedWidgetEntity);

  r.multiStreamProjection({
    name: "latency-probe",
    apply: {
      "widget.created": async () => {
        deliveryTimes.push(Date.now());
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
    deliveryTimes.length = 0;

    await stack.eventDispatcher?.start();
    try {
      await executor.create({ name: "latency-test" }, admin, tdb);

      const deadline = Date.now() + 5000;
      while (Date.now() < deadline && deliveryTimes.length === 0) {
        await new Promise((r) => setTimeout(r, 5));
      }
      expect(deliveryTimes).toHaveLength(1);
    } finally {
      await stack.eventDispatcher?.stop();
    }
  });

  test("dispatcher start/stop cycle with LISTEN attached still delivers after restart", async () => {
    // Repeated start/stop must not leak connections or break LISTEN. After
    // 3 cycles the last .start() should still wake on NOTIFY — if the
    // unlisten handle was mishandled, the subscription would either be
    // stale (LISTEN on a closed connection) or double-registered.
    for (let i = 0; i < 2; i++) {
      await stack.eventDispatcher?.start();
      await stack.eventDispatcher?.stop();
    }

    deliveryTimes.length = 0;
    await stack.eventDispatcher?.start();
    try {
      await executor.create({ name: "restart-probe" }, admin, tdb);

      const deadline = Date.now() + 5000;
      while (Date.now() < deadline && deliveryTimes.length === 0) {
        await new Promise((r) => setTimeout(r, 5));
      }
      expect(deliveryTimes).toHaveLength(1);
    } finally {
      await stack.eventDispatcher?.stop();
    }
  });
});
