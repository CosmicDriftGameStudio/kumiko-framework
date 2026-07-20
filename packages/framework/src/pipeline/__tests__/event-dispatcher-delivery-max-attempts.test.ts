// EventConsumerErrorPolicy.maxAttempts lets a consumer override the
// dispatcher-wide default (kumiko-framework#1349) — a consumer depending on
// infra that may still be provisioning at boot (search adapter) needs more
// retry headroom before it gets dead-lettered. deliverEvents is a pure
// free function, so this is unit-level: no DB, no dispatcher lifecycle.

import { beforeAll, describe, expect, test } from "bun:test";
import type { AppContext } from "../../engine/types";
import { ensureTemporalPolyfill } from "../../time/polyfill";
import type { EventConsumer } from "../event-dispatcher";
import {
  type ConsumerStateRow,
  deliverEvents,
  type StoredEventRow,
} from "../event-dispatcher-delivery";
import { createSearchEventConsumer } from "../system-hooks";

beforeAll(async () => {
  await ensureTemporalPolyfill();
});

function stubContext(): AppContext {
  return {
    db: {} as unknown as AppContext["db"],
    redis: {} as unknown as AppContext["redis"],
    registry: {} as unknown as AppContext["registry"],
  } as AppContext;
}

function stubEvent(id: bigint): StoredEventRow {
  return {
    id,
    aggregateId: "agg-1",
    aggregateType: "widget",
    tenantId: "tenant-1",
    version: 1,
    type: "widget.created",
    eventVersion: 1,
    payload: {},
    metadata: { userId: "system" },
    createdAt: Temporal.Now.instant(),
    createdBy: "system",
  };
}

function stubState(): ConsumerStateRow {
  return {
    name: "consumer",
    instanceId: "shared",
    lastProcessedEventId: 0n,
    status: "idle",
    attempts: 0,
    lastError: null,
    updatedAt: Temporal.Now.instant(),
  };
}

describe("deliverEvents — per-consumer maxAttempts override", () => {
  test("stays alive past the dispatcher-wide default when errorPolicy.maxAttempts is higher", async () => {
    const consumer: EventConsumer = {
      name: "search",
      errorPolicy: { maxAttempts: 20 },
      handler: async () => {
        throw new Error("meilisearch not provisioned yet");
      },
    };

    const outcome = await deliverEvents(
      consumer,
      [stubEvent(1n)],
      stubContext(),
      /* dispatcher-wide default */ 10,
      { ...stubState(), attempts: 10 },
    );

    expect(outcome.attempts).toBe(11);
    expect(outcome.deadLettered).toBe(false);
  });

  test("dead-letters at the override once attempts reach it", async () => {
    const consumer: EventConsumer = {
      name: "search",
      errorPolicy: { maxAttempts: 20 },
      handler: async () => {
        throw new Error("meilisearch not provisioned yet");
      },
    };

    const outcome = await deliverEvents(consumer, [stubEvent(1n)], stubContext(), 10, {
      ...stubState(),
      attempts: 19,
    });

    expect(outcome.attempts).toBe(20);
    expect(outcome.deadLettered).toBe(true);
  });

  test("a consumer without the override still dies at the dispatcher-wide default", async () => {
    const consumer: EventConsumer = {
      name: "plain",
      handler: async () => {
        throw new Error("boom");
      },
    };

    const outcome = await deliverEvents(consumer, [stubEvent(1n)], stubContext(), 10, {
      ...stubState(),
      attempts: 9,
    });

    expect(outcome.attempts).toBe(10);
    expect(outcome.deadLettered).toBe(true);
  });
});

describe("createSearchEventConsumer — errorPolicy wiring", () => {
  test("wires more retry headroom than the dispatcher-wide default", () => {
    const consumer = createSearchEventConsumer(
      {} as unknown as Parameters<typeof createSearchEventConsumer>[0],
      {} as unknown as Parameters<typeof createSearchEventConsumer>[1],
    );

    expect(consumer.errorPolicy?.maxAttempts).toBeGreaterThan(10);
  });
});
