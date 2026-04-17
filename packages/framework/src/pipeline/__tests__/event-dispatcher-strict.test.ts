// Strict-precondition contract: runOnce() without a preceding start() /
// ensureRegistered() must throw, not silently bootstrap. The throw is the
// dispatcher's last line of defense against the prune-race — if pre-reg
// is skipped, the state rows are absent, and acquireConsumerState would
// return skip="not_registered" for every consumer. Failing loudly surfaces
// the misuse instead of swallowing events.
//
// Unit-level because the check happens before any DB call — no pgClient,
// no event-store schema, no setupTestStack needed.

import { describe, expect, test } from "vitest";
import type { AppContext, Registry } from "../../engine/types";
import { createEventDispatcher, type EventConsumer } from "../event-dispatcher";

function stubContext(): AppContext {
  return {
    db: {} as unknown as AppContext["db"],
    redis: {} as unknown as AppContext["redis"],
    registry: {} as unknown as Registry,
  } as AppContext;
}

describe("event-dispatcher — strict runOnce precondition", () => {
  test("runOnce() before start() throws a clear 'not registered' error", async () => {
    const consumers: EventConsumer[] = [{ name: "noop", handler: async () => {} }];
    const dispatcher = createEventDispatcher({
      db: {} as never,
      consumers,
      context: stubContext(),
    });

    await expect(dispatcher.runOnce()).rejects.toThrow(/runOnce\(\) called before start\(\)/);
  });

  test("ensureRegistered() is a valid alternative to start() — runOnce no longer throws", async () => {
    const consumers: EventConsumer[] = [{ name: "noop", handler: async () => {} }];
    let insertCalls = 0;
    const stubDb = {
      insert: () => ({
        values: () => ({ onConflictDoNothing: async () => ++insertCalls }),
      }),
      transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          select: () => ({
            from: () => ({ where: () => ({ for: () => [] }) }),
          }),
          execute: async () => [],
          update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
        }),
    };
    const dispatcher = createEventDispatcher({
      db: stubDb as never,
      consumers,
      context: stubContext(),
    });

    await dispatcher.ensureRegistered();
    expect(insertCalls).toBe(1);
    // runOnce() no longer throws — it drains against the stubbed transaction.
    await expect(dispatcher.runOnce()).resolves.toMatchObject({
      processed: 0,
      failed: 0,
    });
  });
});
