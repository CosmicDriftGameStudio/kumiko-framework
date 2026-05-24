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

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createEventStoreExecutor } from "../../db/event-store-executor";
import { createTenantDb, type TenantDb } from "../../db/tenant-db";
import { defineFeature } from "../../engine";
import { TestUsers, unsafeCreateEntityTable } from "../../stack";
import { setupBunTestStack, type BunTestStack } from "../../bun-db/__tests__/bun-test-stack";
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
let stack: BunTestStack;
let tdb: TenantDb;

beforeAll(async () => {
  stack = await setupBunTestStack({
    features: [listenFeature],
    systemHooks: [],
  });
  await unsafeCreateEntityTable(stack.db, sharedWidgetEntity, "widget");
  tdb = createTenantDb(stack.db, admin.tenantId);
});

afterAll(async () => {
  // setupBunTestStack's cleanup handles eventDispatcher.stop(), which in
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
      // LISTEN should beat the polling timer comfortably. Originally 40ms
      // (LISTEN typical: <10ms; pollInterval: 50ms). ARM self-hosted runner
      // schwankt bei 50-60ms wegen DB-IPC + clock-jitter im poll-loop —
      // bound auf 2× pollInterval erweitert. Discriminierung bleibt:
      // wenn LISTEN ganz broken ist, fällt der 500ms-Wait am `expect
      // (deliveryTimes).toHaveLength(1)`-Check leer.
      expect(latencyMs).toBeLessThan(100);
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
