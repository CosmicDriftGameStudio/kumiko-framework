// E.4 — PG LISTEN/NOTIFY wake-up. Without this, delivery latency is
// bounded below by pollIntervalMs (default 100ms, test-stack 50ms). With
// LISTEN, event-store.append fires `pg_notify` on commit and any
// subscribed dispatcher wakes immediately — latency becomes TCP
// round-trip, typically sub-millisecond on localhost.
//
// The polling timer stays on as a safety net for dropped subscriptions
// and crashes between commit and wake. These tests pin:
//
//   1. NOTIFY → runOnce fires faster than one pollInterval.
//   2. The dispatcher starts cleanly when pgClient is wired and stops
//      without leaking the LISTEN connection.

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createEventStoreExecutor } from "../../db/event-store-executor";
import { buildDrizzleTable } from "../../db/table-builder";
import { createTenantDb, type TenantDb } from "../../db/tenant-db";
import { createEntity, createTextField, defineFeature } from "../../engine";
import { createEntityTable, setupTestStack, type TestStack, TestUsers } from "../../testing";

// --- Fixture ---

const listenEntity = createEntity({
  table: "listen_widgets",
  idType: "uuid",
  fields: { name: createTextField({ required: true }) },
});
const listenTable = buildDrizzleTable("listenWidget", listenEntity);
const executor = createEventStoreExecutor(listenTable, listenEntity, {
  entityName: "listenWidget",
});

const deliveryTimes: number[] = [];

const listenFeature = defineFeature("listen", (r) => {
  r.entity("listenWidget", listenEntity);

  r.postEvent("latency-probe", async () => {
    deliveryTimes.push(Date.now());
  });
});

const admin = TestUsers.admin;
let stack: TestStack;
let tdb: TenantDb;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [listenFeature],
    systemHooks: [],
  });
  await createEntityTable(stack.db.db, listenEntity, "listenWidget");
  tdb = createTenantDb(stack.db.db, admin.tenantId);
});

afterAll(async () => {
  // setupTestStack's cleanup handles eventDispatcher.stop(), which in
  // turn unlistens.
});

// --- Tests ---

describe("E.4 — PG NOTIFY/LISTEN wake-up", () => {
  test("NOTIFY on commit triggers runOnce faster than one pollInterval", async () => {
    // pollIntervalMs in the test-stack is 50ms. If LISTEN works, delivery
    // lands within a few ms of commit; if LISTEN is broken, it takes up
    // to pollIntervalMs. Use a generous upper bound that still discriminates:
    // if the timer drives delivery, the gap between append and delivery
    // is 25–50ms on average. If LISTEN drives it, it's sub-10ms.
    deliveryTimes.length = 0;

    await stack.eventDispatcher?.start();
    try {
      const appendedAt = Date.now();
      await executor.create({ name: "latency-test" }, admin, tdb);

      // Wait up to 500ms, then check latency.
      const deadline = Date.now() + 500;
      while (Date.now() < deadline && deliveryTimes.length === 0) {
        await new Promise((r) => setTimeout(r, 5));
      }
      expect(deliveryTimes).toHaveLength(1);

      const latencyMs = (deliveryTimes[0] ?? 0) - appendedAt;
      // LISTEN should beat the polling timer comfortably. If this fires at
      // ~50ms (one full poll interval) the subscription likely didn't
      // attach. 40ms is a loose upper bound that still discriminates.
      expect(latencyMs).toBeLessThan(40);
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
      const appendedAt = Date.now();
      await executor.create({ name: "restart-probe" }, admin, tdb);
      const deadline = Date.now() + 500;
      while (Date.now() < deadline && deliveryTimes.length === 0) {
        await new Promise((r) => setTimeout(r, 5));
      }
      expect(deliveryTimes).toHaveLength(1);
      // Latency must still be LISTEN-fast (< pollInterval) — if the
      // subscription silently dropped, the timer would deliver at ~50ms.
      expect((deliveryTimes[0] ?? 0) - appendedAt).toBeLessThan(40);
    } finally {
      await stack.eventDispatcher?.stop();
    }
  });
});
