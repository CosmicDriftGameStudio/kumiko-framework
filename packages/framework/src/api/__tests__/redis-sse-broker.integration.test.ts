import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { createTestRedis, type TestRedis } from "../../stack";
import { waitFor } from "../../testing/wait-for";
import { generateId } from "../../utils";
import { createRedisSseBroker, type RedisSseBroker } from "../redis-sse-broker";
import type { SseEvent } from "../sse-broker";

let testRedis: TestRedis;
// keyPrefix on testRedis.redis does not apply to pub/sub channel names
// (stack/redis.ts), so isolation from other parallel test files comes from
// generateId()-suffixed channel/userId values below, not from the prefix.
const brokers: RedisSseBroker[] = [];

function trackedBroker(): RedisSseBroker {
  const broker = createRedisSseBroker({ redisUrl: testRedis.redisUrl });
  brokers.push(broker);
  return broker;
}

beforeAll(async () => {
  testRedis = await createTestRedis();
});

afterAll(async () => {
  await testRedis.cleanup();
});

afterEach(async () => {
  await Promise.all(brokers.splice(0).map((b) => b.close()));
});

describe("createRedisSseBroker", () => {
  test("pushToChannel on one broker reaches a client registered on another (cross-pod fanout)", async () => {
    const podA = trackedBroker();
    const podB = trackedBroker();
    const channel = `test-channel-${generateId()}`;
    const received: SseEvent[] = [];

    podA.addClient(
      channel,
      (event) => received.push(event),
      () => {},
    );

    // Retry the publish inside the predicate, not just the wait: Pub/Sub
    // does not buffer for a subscriber whose psubscribe ack hasn't landed
    // yet (a one-time race right after broker construction, not
    // reproducible once real traffic starts seconds after boot) — a single
    // fire-and-check would be flaky rather than proving the real property.
    await waitFor(() => {
      podB.pushToChannel(channel, { type: "unit.updated", data: { id: "1" } });
      return received.length >= 1;
    });
    expect(received[0]).toEqual({ type: "unit.updated", data: { id: "1" } });
  });

  test("publishAccessInvalidation on one broker fires subscribeAccessInvalidation listeners on another", async () => {
    const podA = trackedBroker();
    const podB = trackedBroker();
    const userId = `user-${generateId()}`;
    let invalidated = false;

    podA.subscribeAccessInvalidation(userId, () => {
      invalidated = true;
    });

    await waitFor(() => {
      podB.publishAccessInvalidation(userId);
      return invalidated;
    });
    expect(invalidated).toBe(true);
  });

  test("a client on channel A never receives an event published to channel B (no cross-tenant leak)", async () => {
    const podA = trackedBroker();
    const podB = trackedBroker();
    const channelA = `tenant-a-${generateId()}`;
    const channelB = `tenant-b-${generateId()}`;
    const receivedOnA: SseEvent[] = [];
    const receivedOnControl: SseEvent[] = [];

    podA.addClient(
      channelA,
      (event) => receivedOnA.push(event),
      () => {},
    );
    // Control channel proves the psubscribe pipe itself is alive — without
    // this, a broken subscription would make the negative assertion below
    // pass for the wrong reason (nothing ever arrives, on any channel).
    podA.addClient(
      channelB,
      (event) => receivedOnControl.push(event),
      () => {},
    );

    await waitFor(() => {
      podB.pushToChannel(channelB, { type: "unit.updated", data: { id: "leak-probe" } });
      return receivedOnControl.length >= 1;
    });
    expect(receivedOnA).toHaveLength(0);
  });

  test("subscribeAccessInvalidation for one user is never fired by an invalidation for another user", async () => {
    const podA = trackedBroker();
    const podB = trackedBroker();
    const userA = `user-a-${generateId()}`;
    const userB = `user-b-${generateId()}`;
    let invalidatedA = false;
    let invalidatedBControl = false;

    podA.subscribeAccessInvalidation(userA, () => {
      invalidatedA = true;
    });
    podA.subscribeAccessInvalidation(userB, () => {
      invalidatedBControl = true;
    });

    await waitFor(() => {
      podB.publishAccessInvalidation(userB);
      return invalidatedBControl;
    });
    expect(invalidatedA).toBe(false);
  });

  test("a malformed message on the channel namespace is dropped, not thrown, and does not kill delivery", async () => {
    const podA = trackedBroker();
    const publisherRaw = new (await import("ioredis")).default(testRedis.redisUrl);
    const channel = `test-channel-${generateId()}`;
    const received: SseEvent[] = [];

    podA.addClient(
      channel,
      (event) => received.push(event),
      () => {},
    );

    try {
      await waitFor(async () => {
        // Not valid JSON — simulates a foreign/misbehaving publisher on the
        // shared kumiko:sse:* namespace.
        await publisherRaw.publish(`kumiko:sse:ch:${channel}`, "not-json{{{");
        // Broker must still be alive: a real event right after must arrive.
        podA.pushToChannel(channel, { type: "unit.updated", data: { id: "after-garbage" } });
        return received.length >= 1;
      });
      expect(received[0]).toEqual({ type: "unit.updated", data: { id: "after-garbage" } });
    } finally {
      publisherRaw.disconnect();
    }
  });
});
