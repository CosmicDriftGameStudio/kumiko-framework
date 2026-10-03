import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Redis } from "ioredis";
import { createTestRedis, type TestRedis } from "../../stack/redis.js";
import { waitFor } from "../../testing/wait-for.js";
import { createRedisCacheSyncBus } from "../cache-sync-bus.js";

// Real Redis: two buses stand in for two pods, and CLIENT KILL severs the
// subscriber connection the way a network blip would.
let testRedis: TestRedis;
let admin: Redis;

beforeAll(async () => {
  testRedis = await createTestRedis();
  admin = new Redis(testRedis.redisUrl);
});

afterAll(async () => {
  admin.disconnect();
  await testRedis.cleanup();
});

describe("redis cache sync bus", () => {
  test("a publish reaches the other bus and not a different channel prefix", async () => {
    const busA = createRedisCacheSyncBus({
      redisUrl: testRedis.redisUrl,
      channelPrefix: testRedis.keyPrefix,
    });
    const busB = createRedisCacheSyncBus({
      redisUrl: testRedis.redisUrl,
      channelPrefix: testRedis.keyPrefix,
    });
    const foreign = createRedisCacheSyncBus({
      redisUrl: testRedis.redisUrl,
      channelPrefix: `${testRedis.keyPrefix}other:`,
    });
    const onB: unknown[] = [];
    const onForeign: unknown[] = [];
    busB.subscribe("t", (message) => onB.push(message));
    foreign.subscribe("t", (message) => onForeign.push(message));

    // The first publishes can race the psubscribe ack, so repeat until it lands.
    await waitFor(async () => {
      busA.publish("t", { n: 1 });
      return onB.length > 0;
    });
    expect(onB[0]).toEqual({ n: 1 });
    expect(onForeign).toEqual([]);

    await Promise.all([busA.close(), busB.close(), foreign.close()]);
  });

  test("resync fires after the subscriber connection is killed and the subscription is back", async () => {
    const connectionName = `cache-sync-test-${crypto.randomUUID()}`;
    const options = { extra: { connectionName } };
    const busA = createRedisCacheSyncBus({
      redisUrl: testRedis.redisUrl,
      channelPrefix: testRedis.keyPrefix,
      clientOptions: options,
    });
    const busB = createRedisCacheSyncBus({
      redisUrl: testRedis.redisUrl,
      channelPrefix: testRedis.keyPrefix,
    });
    let resyncs = 0;
    const received: unknown[] = [];
    busA.onResync(() => {
      resyncs += 1;
    });
    busA.subscribe("t", (message) => received.push(message));

    await waitFor(async () => {
      busB.publish("t", "warmup");
      return received.length > 0;
    });
    expect(resyncs).toBe(0);

    const listing = String(await admin.client("LIST"));
    const ids = listing
      .split("\n")
      .filter((line) => line.includes(`name=${connectionName}`))
      .map((line) => /(?:^|\s)id=(\d+)/.exec(line)?.[1])
      .filter((id): id is string => id !== undefined);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) await admin.client("KILL", "ID", id);

    await waitFor(async () => resyncs === 1);

    // Subscription is live again: a publish after the resync is delivered.
    received.length = 0;
    await waitFor(async () => {
      busB.publish("t", "after-reconnect");
      return received.includes("after-reconnect");
    });

    await Promise.all([busA.close(), busB.close()]);
  });
});
