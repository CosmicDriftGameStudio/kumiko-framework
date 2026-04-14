import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { z } from "zod";
import { createEntity, createRegistry, createTextField, defineFeature } from "../../engine";
import { createEventBroker, eventOutboxTable } from "../../pipeline";
import { EVENT_OUTBOX_PARTIAL_INDEX_SQL } from "../../pipeline/outbox-table";
import {
  createEntityTable,
  createTestDb,
  createTestRedis,
  pushTables,
  type TestDb,
  type TestRedis,
  TestUsers,
} from "../../testing";
import { buildServer } from "../server";

// Integration test for the production wiring: we call buildServer directly
// (NOT setupTestStack) and pass the outbox config the way a real consumer
// would. Proves that options.outbox → createDispatcher with outbox →
// createOutboxPoller flow works end-to-end without test-stack magic.

const itemEntity = createEntity({
  table: "outbox_server_items",
  fields: { label: createTextField({ required: true }) },
});

const subscriberCalls: Array<{ type: string; payload: unknown }> = [];

const feature = defineFeature("outbox-server-test", (r) => {
  r.entity("item", itemEntity);
  r.writeHandler(
    "item:create",
    z.object({ label: z.string() }),
    async (event, ctx) => {
      await ctx.emit("outbox-server-test:event:item.created", {
        label: event.payload.label,
      });
      return {
        isSuccess: true,
        data: { kind: "save", id: 1, data: {}, changes: {}, previous: {}, isNew: true },
      };
    },
    { access: { roles: ["Admin"] } },
  );
});

const registry = createRegistry([feature]);
const JWT_SECRET = "outbox-server-integration-secret-32-chars!!";

let testDb: TestDb;
let testRedis: TestRedis;
let subscriberRedis: import("ioredis").default | undefined;
let server: Awaited<ReturnType<typeof setupServer>>;

async function setupServer() {
  subscriberRedis = testRedis.redis.duplicate();
  const eventBroker = createEventBroker(testRedis.redis, testRedis.redis.duplicate());
  eventBroker.subscribe("outbox-server-test:event:item.created", async (event) => {
    subscriberCalls.push(event);
  });

  return buildServer({
    registry,
    context: { db: testDb.db, redis: testRedis.redis, registry },
    jwtSecret: JWT_SECRET,
    outbox: {
      redis: testRedis.redis,
      subscriberRedis,
      eventBroker,
      pollIntervalMs: 50,
      maxAttempts: 3,
    },
  });
}

beforeEach(async () => {
  subscriberCalls.length = 0;
  [testDb, testRedis] = await Promise.all([createTestDb(), createTestRedis()]);
  await createEntityTable(testDb.db, itemEntity);
  await pushTables(testDb.db, { eventOutbox: eventOutboxTable });
  await testDb.db.execute(EVENT_OUTBOX_PARTIAL_INDEX_SQL);
  server = await setupServer();
});

afterEach(async () => {
  await server.outboxPoller?.stop();
  if (subscriberRedis) subscriberRedis.disconnect();
  await Promise.all([testDb.cleanup(), testRedis.cleanup()]);
});

describe("buildServer outbox integration", () => {
  test("server exposes outboxPoller when options.outbox is provided", () => {
    expect(server.outboxPoller).toBeDefined();
    expect(typeof server.outboxPoller?.start).toBe("function");
    expect(typeof server.outboxPoller?.runOnce).toBe("function");
  });

  test("end-to-end: HTTP → handler → ctx.emit → outbox → poller → subscriber", async () => {
    const token = await server.jwt.sign(TestUsers.admin);
    const res = await server.app.request("/api/write", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        type: "outbox-server-test:write:item:create",
        payload: { label: "prod-path" },
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { isSuccess: boolean };
    expect(body.isSuccess).toBe(true);

    // Row exists, then drain the poller (same API a real caller would use)
    const rowsBefore = await testDb.db.select().from(eventOutboxTable);
    expect(rowsBefore).toHaveLength(1);

    const drain = await server.outboxPoller?.runOnce();
    expect(drain).toEqual({ processed: 1, failed: 0 });

    expect(subscriberCalls).toHaveLength(1);
    expect(subscriberCalls[0]?.payload).toMatchObject({ label: "prod-path" });
  });

  test("without options.outbox, ctx.emit throws at the handler level", async () => {
    // Tear down the outbox-enabled server, build one WITHOUT outbox.
    await server.outboxPoller?.stop();
    if (subscriberRedis) subscriberRedis.disconnect();
    subscriberRedis = undefined;

    const plainServer = buildServer({
      registry,
      context: { db: testDb.db, redis: testRedis.redis, registry },
      jwtSecret: JWT_SECRET,
    });

    expect(plainServer.outboxPoller).toBeUndefined();

    const token = await plainServer.jwt.sign(TestUsers.admin);
    const res = await plainServer.app.request("/api/write", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        type: "outbox-server-test:write:item:create",
        payload: { label: "no-outbox" },
      }),
    });

    // Handler threw because ctx.emit has no outbox configured — the batch
    // propagates the error and the route returns 400 with isSuccess: false.
    expect(res.status).toBe(400);
    const body = (await res.json()) as { isSuccess: boolean; error: string };
    expect(body.isSuccess).toBe(false);
    expect(body.error).toContain("outbox");
  });
});
