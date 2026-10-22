// A Redis outage must not park the access-invalidation consumer dead: later revocations would
// never reach open SSE streams. deliverEvents is a pure function, so this stays unit-level.
import { beforeAll, describe, expect, test } from "bun:test";
import type { SseBroker } from "../../api/sse-broker.ts";
import type { AppContext } from "../../engine/types/index.ts";
import { ensureTemporalPolyfill } from "../../time/polyfill.ts";
import {
  type ConsumerStateRow,
  deliverEvents,
  type StoredEventRow,
} from "../event-dispatcher-delivery.ts";
import { createAccessInvalidationEventConsumer } from "../system-hooks.ts";

beforeAll(async () => {
  await ensureTemporalPolyfill();
});

const DISPATCHER_DEFAULT_MAX_ATTEMPTS = 10;

function sessionRevokedEvent(): StoredEventRow {
  return {
    id: 1n,
    aggregateId: "agg-1",
    aggregateType: "session",
    tenantId: "tenant-1",
    version: 1,
    type: "sessions:event:session-revoked",
    eventVersion: 1,
    payload: { userId: "user-1" },
    metadata: { userId: "system" },
    createdAt: Temporal.Now.instant(),
    createdBy: "system",
  };
}

function idleState(attempts: number): ConsumerStateRow {
  return {
    name: "access-invalidation",
    instanceId: "shared",
    lastProcessedEventId: 0n,
    status: "idle",
    attempts,
    rearmCount: 0,
    pendingGaps: [],
    lastFailedEventId: null,
    lastError: null,
    updatedAt: Temporal.Now.instant(),
  };
}

function brokerFailingWhile(isDown: () => boolean, published: string[]): SseBroker {
  return {
    publishAccessInvalidation: async (userId: string) => {
      if (isDown()) throw new Error("redis unavailable");
      published.push(userId);
    },
  } as unknown as SseBroker;
}

const context = {} as AppContext;

describe("access-invalidation consumer during a Redis outage", () => {
  test("is not dead-lettered past the dispatcher default and delivers once Redis is back", async () => {
    let down = true;
    let nowMs = 0;
    const published: string[] = [];
    const consumer = createAccessInvalidationEventConsumer(
      brokerFailingWhile(() => down, published),
      { now: () => nowMs },
    );

    const outage = await deliverEvents(
      consumer,
      [sessionRevokedEvent()],
      context,
      DISPATCHER_DEFAULT_MAX_ATTEMPTS,
      idleState(DISPATCHER_DEFAULT_MAX_ATTEMPTS * 10),
    );
    expect(outage.deadLettered).toBe(false);
    expect(outage.cursor).toBe(0n);

    down = false;
    nowMs += 60_000;
    const recovered = await deliverEvents(
      consumer,
      [sessionRevokedEvent()],
      context,
      DISPATCHER_DEFAULT_MAX_ATTEMPTS,
      idleState(outage.attempts),
    );

    expect(published).toEqual(["user-1"]);
    expect(recovered.cursor).toBe(1n);
    expect(recovered.attempts).toBe(0);
  });

  test("backs off: retries inside the backoff window do not call Redis again", async () => {
    let calls = 0;
    let nowMs = 0;
    const consumer = createAccessInvalidationEventConsumer(
      {
        publishAccessInvalidation: async () => {
          calls += 1;
          throw new Error("redis unavailable");
        },
      } as unknown as SseBroker,
      { now: () => nowMs },
    );
    const event = sessionRevokedEvent();
    const deliver = () =>
      deliverEvents(consumer, [event], context, DISPATCHER_DEFAULT_MAX_ATTEMPTS, idleState(0));

    await deliver();
    await deliver();
    expect(calls).toBe(1);

    nowMs += 60_000;
    await deliver();
    expect(calls).toBe(2);
  });
});
