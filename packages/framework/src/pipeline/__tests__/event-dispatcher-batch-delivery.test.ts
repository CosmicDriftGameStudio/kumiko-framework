// #3227 — deliverEvents' batchHandler fast-path: batch success must land
// the exact outcome the per-event loop would produce, a batch throw falls
// back to per-event delivery without bumping attempts for the failed
// batch attempt itself, and pending-gap resolution still splits pending
// vs new ids the same way it does for the per-event path.

import { beforeAll, describe, expect, test } from "bun:test";
import type { AppContext } from "../../engine/types";
import { ensureTemporalPolyfill } from "../../time/polyfill";
import type { EventConsumer } from "../event-dispatcher";
import {
  type ConsumerStateRow,
  deliverEvents,
  type StoredEventRow,
} from "../event-dispatcher-delivery";

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

function stubState(overrides: Partial<ConsumerStateRow> = {}): ConsumerStateRow {
  return {
    name: "consumer",
    instanceId: "shared",
    lastProcessedEventId: 0n,
    status: "idle",
    attempts: 0,
    rearmCount: 0,
    pendingGaps: [],
    lastError: null,
    updatedAt: Temporal.Now.instant(),
    ...overrides,
  };
}

describe("deliverEvents — batchHandler fast-path", () => {
  test("batch success calls batchHandler once, never handler, and matches the per-event outcome", async () => {
    const rows = [1n, 2n, 3n].map(stubEvent);
    const batchCalls: string[][] = [];
    let handlerCalls = 0;

    const batchConsumer: EventConsumer = {
      name: "search",
      batchHandler: async (events) => {
        batchCalls.push(events.map((e) => e.id));
      },
      handler: async () => {
        handlerCalls += 1;
      },
    };
    const perEventConsumer: EventConsumer = {
      name: "search",
      handler: async () => {
        // no-op — succeeds for every event, same as the batch above
      },
    };

    const batchOutcome = await deliverEvents(batchConsumer, rows, stubContext(), 10, stubState());
    const perEventOutcome = await deliverEvents(
      perEventConsumer,
      rows,
      stubContext(),
      10,
      stubState(),
    );

    expect(batchCalls).toEqual([["1", "2", "3"]]);
    expect(handlerCalls).toBe(0);
    expect(batchOutcome).toEqual(perEventOutcome);
    expect(batchOutcome.cursor).toBe(3n);
    expect(batchOutcome.attempts).toBe(0);
    expect(batchOutcome.lastError).toBeNull();
    expect(batchOutcome.processed).toBe(3);
    expect(batchOutcome.failed).toBe(0);
  });

  test("pending-gap ids resolve the same way as per-event delivery", async () => {
    const rows = [4n, 7n, 11n, 12n].map(stubEvent);
    const consumer: EventConsumer = {
      name: "search",
      batchHandler: async () => {
        // succeeds
      },
      handler: async () => {
        throw new Error("handler must not run on batch success");
      },
    };

    const outcome = await deliverEvents(
      consumer,
      rows,
      stubContext(),
      10,
      stubState({ lastProcessedEventId: 10n }),
    );

    expect(outcome.resolvedPendingIds).toEqual([4n, 7n]);
    expect(outcome.cursor).toBe(12n);
  });

  test("batch throws, one poison row: falls back to per-event delivery without bumping attempts for the batch failure itself", async () => {
    const rows = [1n, 2n, 3n, 4n, 5n].map(stubEvent);
    const handlerCalls: string[] = [];
    const consumer: EventConsumer = {
      name: "search",
      errorPolicy: { maxAttempts: 2 },
      batchHandler: async () => {
        throw new Error("batch failed");
      },
      handler: async (event) => {
        handlerCalls.push(event.id);
        if (event.id === "3") throw new Error("poison event");
      },
    };

    const first = await deliverEvents(consumer, rows, stubContext(), 10, stubState());
    expect(first.cursor).toBe(2n);
    expect(first.attempts).toBe(1);
    expect(first.deadLettered).toBe(false);
    expect(handlerCalls).toEqual(["1", "2", "3"]);

    const remaining = [3n, 4n, 5n].map(stubEvent);
    const second = await deliverEvents(
      consumer,
      remaining,
      stubContext(),
      10,
      stubState({ lastProcessedEventId: first.cursor, attempts: first.attempts }),
    );
    expect(second.attempts).toBe(2);
    expect(second.deadLettered).toBe(true);
  });

  test("batch throws with skipApplyErrors: true skips the poison row and delivers the rest via handler", async () => {
    const rows = [1n, 2n, 3n, 4n, 5n].map(stubEvent);
    const handlerCalls: string[] = [];
    const consumer: EventConsumer = {
      name: "search",
      errorPolicy: { skipApplyErrors: true },
      batchHandler: async () => {
        throw new Error("batch failed");
      },
      handler: async (event) => {
        handlerCalls.push(event.id);
        if (event.id === "3") throw new Error("poison event");
      },
    };

    const outcome = await deliverEvents(consumer, rows, stubContext(), 10, stubState());

    expect(outcome.cursor).toBe(5n);
    expect(handlerCalls).toEqual(["1", "2", "3", "4", "5"]);
  });
});
