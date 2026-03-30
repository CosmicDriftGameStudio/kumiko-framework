import Redis from "ioredis";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createTestRedis, type TestRedis } from "../../testing";
import { createEventBroker } from "../event-broker";
import { createEventLog } from "../event-log";
import { createIdempotencyGuard } from "../idempotency";

let testRedis: TestRedis;
let subscriberRedis: Redis;

beforeAll(async () => {
  testRedis = await createTestRedis();
  const redisUrl = process.env["REDIS_URL"]!;
  subscriberRedis = new Redis(redisUrl, { db: testRedis.redis.options.db });
});

afterAll(async () => {
  subscriberRedis.disconnect();
  await testRedis.cleanup();
});

// --- Event Broker ---

describe("event broker", () => {
  test("publish and subscribe", async () => {
    const broker = createEventBroker(testRedis.redis, subscriberRedis);
    const received: unknown[] = [];

    broker.subscribe("test.created", async (event) => {
      received.push(event.payload);
    });

    await broker.start();

    // Small delay for subscription to be ready
    await new Promise((r) => setTimeout(r, 50));

    await broker.publish({ type: "test.created", payload: { id: 1, name: "hello" } });

    // Wait for message delivery
    await new Promise((r) => setTimeout(r, 100));

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({ id: 1, name: "hello" });

    await broker.stop();
  });

  test("only receives subscribed event types", async () => {
    const broker = createEventBroker(testRedis.redis, subscriberRedis);
    const received: unknown[] = [];

    broker.subscribe("type.a", async (event) => {
      received.push(event);
    });

    await broker.start();
    await new Promise((r) => setTimeout(r, 50));

    await broker.publish({ type: "type.b", payload: { ignored: true } });
    await broker.publish({ type: "type.a", payload: { captured: true } });

    await new Promise((r) => setTimeout(r, 100));

    expect(received).toHaveLength(1);

    await broker.stop();
  });
});

// --- Idempotency ---

describe("idempotency guard", () => {
  test("returns null for new request", async () => {
    const guard = createIdempotencyGuard(testRedis.redis);
    const result = await guard.check("req-new-123");
    expect(result).toBeNull();
  });

  test("returns cached result for duplicate request", async () => {
    const guard = createIdempotencyGuard(testRedis.redis);
    const requestId = "req-dup-456";

    await guard.store(requestId, { isSuccess: true, data: { id: 1 } });
    const cached = await guard.check(requestId);

    expect(cached).not.toBeNull();
    expect(JSON.parse(cached!)).toEqual({ isSuccess: true, data: { id: 1 } });
  });

  test("expires after TTL", async () => {
    const guard = createIdempotencyGuard(testRedis.redis, { ttlSeconds: 1 });
    const requestId = "req-ttl-789";

    await guard.store(requestId, { done: true });

    // Should exist immediately
    expect(await guard.check(requestId)).not.toBeNull();

    // Wait for expiry
    await new Promise((r) => setTimeout(r, 1100));

    expect(await guard.check(requestId)).toBeNull();
  });
});

// --- Event Log ---

describe("event log", () => {
  test("appends and retrieves events", async () => {
    const log = createEventLog(testRedis.redis);

    await log.append({ type: "user.create", payload: { email: "a@b.de" }, userId: 1, tenantId: 1 });
    await log.append({ type: "user.update", payload: { name: "Marc" }, userId: 1, tenantId: 1 });

    const recent = await log.recent(10);
    expect(recent.length).toBeGreaterThanOrEqual(2);
    expect(recent[0]?.type).toBe("user.update"); // most recent first
    expect(recent[1]?.type).toBe("user.create");
  });

  test("limits returned entries", async () => {
    const log = createEventLog(testRedis.redis, "kumiko:test:limit-log");

    for (let i = 0; i < 5; i++) {
      await log.append({ type: `event.${i}`, payload: {}, userId: 1, tenantId: 1 });
    }

    const recent = await log.recent(3);
    expect(recent).toHaveLength(3);
  });
});
