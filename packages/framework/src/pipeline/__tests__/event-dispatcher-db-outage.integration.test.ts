// kumiko-framework#3243: a DB outage must not crash the dispatcher and must
// not stay silent forever. The idle pre-check's error log (doPass) fires once
// per outage, and a matching "recovered" line must fire once the DB answers
// again, so ops can see the return without restarting the process. Routes the
// dispatcher's own db connection through a TCP proxy (same pattern as
// bun-db/__tests__/postgres-closed-socket-write.integration.test.ts) so the
// outage can be simulated without touching the shared test DB other suites
// depend on.

import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import net from "node:net";
import postgres from "postgres";
import { createDbConnection } from "../../db/connection";
import { createEventStoreExecutor } from "../../db/event-store-executor";
import { createTenantDb, type TenantDb } from "../../db/tenant-db";
import { defineFeature } from "../../engine";
import type { StoredEvent } from "../../event-store";
import type { Logger } from "../../logging/types";
import { type MetricEvent, RecordingMeter, registerStandardMetrics } from "../../observability";
import { createEventDispatcher, type EventConsumer, type EventDispatcher } from "../../pipeline";
import {
  resetEventStore,
  setupTestStack,
  type TestStack,
  TestUsers,
  unsafeCreateEntityTable,
} from "../../stack";
import { sharedWidgetEntity, sharedWidgetTable, waitFor } from "../../testing";
import { testDatabaseUrl } from "../../testing/closed-connection-error";

const executor = createEventStoreExecutor(sharedWidgetTable, sharedWidgetEntity, {
  entityName: "widget",
});

const feature = defineFeature("dboutage", (r) => {
  r.entity("widget", sharedWidgetEntity);
});

const admin = TestUsers.admin;
let stack: TestStack;
let tdb: TenantDb;
// setupTestStack creates its own ephemeral kumiko_test_<random> DB and never
// exposes its name/URL. Passing an explicit name here so the proxy below
// can build the exact connection string setupTestStack itself would have.
const testDbName = `kumiko_test_dboutage_${crypto.randomUUID().slice(0, 8)}`;

beforeAll(async () => {
  stack = await setupTestStack({ features: [feature], systemHooks: [], dbName: testDbName });
  await unsafeCreateEntityTable(stack.db, sharedWidgetEntity, "widget");
  tdb = createTenantDb(stack.db, admin.tenantId);
});

afterEach(async () => {
  await resetEventStore(stack, ["read_widgets"]);
});

async function appendWidget(name: string): Promise<void> {
  await executor.create({ name }, admin, tdb);
}

function recordingLogger(): Logger & { readonly lines: string[] } {
  const lines: string[] = [];
  const logger: Logger & { lines: string[] } = {
    lines,
    info: (msg) => lines.push(`info:${msg}`),
    warn: (msg) => lines.push(`warn:${msg}`),
    error: (msg) => lines.push(`error:${msg}`),
    debug: () => {},
    child: () => logger,
  };
  return logger;
}

// A TCP passthrough to the real test DB. Stopping it (server.close() +
// destroying every live socket) simulates an outage without touching the
// shared test DB; restarting on the SAME port simulates the DB coming back
// without the dispatcher's client needing a new connection string.
function startDbProxy(dbUrl: URL): { server: net.Server; stop: () => Promise<void> } {
  const sockets = new Set<net.Socket>();
  const server = net.createServer((downstream) => {
    sockets.add(downstream);
    const upstream = net.connect(Number(dbUrl.port), dbUrl.hostname);
    sockets.add(upstream);
    downstream.pipe(upstream).pipe(downstream);
    downstream.on("error", () => upstream.destroy());
    upstream.on("error", () => downstream.destroy());
    downstream.on("close", () => sockets.delete(downstream));
    upstream.on("close", () => sockets.delete(upstream));
  });
  return {
    server,
    stop: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

async function listenOn(server: net.Server, port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, resolve);
  });
}

describe("E: dispatcher survives a DB outage and logs the recovery", () => {
  test("idle pre-check logs the outage once and the recovery once, then resumes delivery", async () => {
    const dbUrl = new URL(testDatabaseUrl().replace(/\/[^/]+$/, `/${testDbName}`));
    const proxy1 = startDbProxy(dbUrl);
    await listenOn(proxy1.server, 0);
    const address = proxy1.server.address();
    if (address === null || typeof address === "string") {
      throw new Error("proxy did not bind to a TCP port");
    }
    const proxyPort = address.port;

    const proxiedUrl = new URL(dbUrl.toString());
    proxiedUrl.hostname = "127.0.0.1";
    proxiedUrl.port = String(proxyPort);
    const proxiedDb = createDbConnection(proxiedUrl.toString(), { maxConnections: 1 });

    const observed: string[] = [];
    const consumer: EventConsumer = {
      name: "dboutage:consumer",
      handler: async (event: StoredEvent) => {
        observed.push(String(event.payload["name"]));
      },
    };

    const logger = recordingLogger();
    const metricEvents: MetricEvent[] = [];
    const lastListenGauge = (): number | undefined =>
      metricEvents
        .filter(
          (e) => e.type === "gauge.set" && e.name === "kumiko_event_dispatcher_listen_connected",
        )
        .pop()?.value;
    const meter = new RecordingMeter((e) => metricEvents.push(e));
    registerStandardMetrics(meter);
    const listenClient = postgres(proxiedUrl.toString(), { max: 1 });
    const dispatcher: EventDispatcher = createEventDispatcher({
      db: proxiedDb.db,
      consumers: [consumer],
      context: { db: proxiedDb.db, log: logger },
      pollIntervalMs: 50,
      pgClient: listenClient,
      meter,
    });

    try {
      await dispatcher.start();
      expect(lastListenGauge()).toBe(1);

      await appendWidget("before-outage");
      await waitFor(() => observed.includes("before-outage"));
      // Delivery is at-least-once, so killing the proxy mid-commit would
      // redeliver "before-outage" after recovery. Drain first so the turn's
      // TX has already committed.
      await dispatcher.drain();

      await proxy1.stop();

      await waitFor(() => logger.lines.some((line) => line.includes("idle pre-check failed")));
      expect(lastListenGauge()).toBe(0);

      const proxy2 = startDbProxy(dbUrl);
      await listenOn(proxy2.server, proxyPort);
      try {
        await waitFor(() => logger.lines.some((line) => line.includes("idle pre-check recovered")));

        await appendWidget("after-recovery");
        await waitFor(() => observed.includes("after-recovery"));
      } finally {
        await proxy2.stop();
      }

      const failedCount = logger.lines.filter((line) =>
        line.includes("idle pre-check failed"),
      ).length;
      const recoveredCount = logger.lines.filter((line) =>
        line.includes("idle pre-check recovered"),
      ).length;
      expect(failedCount).toBe(1);
      expect(recoveredCount).toBe(1);
      expect(observed).toEqual(["before-outage", "after-recovery"]);
    } finally {
      await dispatcher.stop();
      await listenClient.end({ timeout: 1 });
      await proxiedDb.close();
    }
  });
});
