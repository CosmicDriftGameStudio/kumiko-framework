// event-store.ts's and projection-rebuild.ts's SELECT helpers run through
// unsafeReadRetrying; this proves the retry fires using a real captured
// driver error. Writes and the FOR UPDATE reads inside transaction() stay
// out of scope — unretried by design.

import { beforeAll, describe, expect, test } from "bun:test";
import { captureClosedConnectionError } from "../../../testing/closed-connection-error";
import {
  selectAggregateMaxVersion,
  selectEventsHighWaterMark,
  selectNextEventIdAfter,
  selectStreamMaxVersion,
} from "../event-store";
import {
  countSubscribedEvents,
  selectEventsForProjectionRebuildBatch,
} from "../projection-rebuild";

let closedConnectionError: unknown;

beforeAll(async () => {
  closedConnectionError = await captureClosedConnectionError();
});

type RecordedCall = { readonly sql: string; readonly params: readonly unknown[] | undefined };

type FakeClient = {
  unsafe: (sql: string, params?: readonly unknown[]) => Promise<readonly unknown[]>;
  begin: () => never;
  options: { max: number };
  calls: number;
  recordedCalls: RecordedCall[];
};

function fakeClient(failures: unknown[], row: Record<string, unknown>): FakeClient {
  const remaining = [...failures];
  const client: FakeClient = {
    calls: 0,
    recordedCalls: [],
    options: { max: 1 },
    unsafe: async (sql, params) => {
      client.calls++;
      client.recordedCalls.push({ sql, params });
      const err = remaining.shift();
      if (err) throw err;
      return [row];
    },
    begin: () => {
      throw new Error("not used in test");
    },
  };
  return client;
}

describe("framework db/queries — closed-connection retry", () => {
  test("selectStreamMaxVersion retries once and returns the version", async () => {
    const db = fakeClient([closedConnectionError], { v: 5 });
    const result = await selectStreamMaxVersion(db as never, "agg1", "t1");
    expect(result).toBe(5);
    expect(db.calls).toBe(2);
    expect(db.recordedCalls).toHaveLength(2);
    expect(db.recordedCalls[0]).toEqual(db.recordedCalls[1]);
  });

  test("selectAggregateMaxVersion retries once and returns the version", async () => {
    const db = fakeClient([closedConnectionError], { v: 7 });
    const result = await selectAggregateMaxVersion(db as never, "agg1");
    expect(result).toBe(7);
    expect(db.calls).toBe(2);
  });

  test("selectEventsHighWaterMark retries once and returns the max id", async () => {
    const db = fakeClient([closedConnectionError], { max: 42n });
    const result = await selectEventsHighWaterMark(db as never);
    expect(result).toBe(42n);
    expect(db.calls).toBe(2);
  });

  test("selectNextEventIdAfter retries once and returns the next id", async () => {
    const db = fakeClient([closedConnectionError], { id: 43n });
    const result = await selectNextEventIdAfter(db as never, 42n);
    expect(result).toBe(43n);
    expect(db.calls).toBe(2);
  });

  test("selectEventsForProjectionRebuildBatch retries once and returns rows", async () => {
    const db = fakeClient([closedConnectionError], { id: "1", type: "created" });
    const rows = await selectEventsForProjectionRebuildBatch(
      db as never,
      ["user"],
      ["user:created"],
      0n,
      100,
    );
    expect(rows).toHaveLength(1);
    expect(db.calls).toBe(2);
  });

  test("countSubscribedEvents retries once and returns the count", async () => {
    const db = fakeClient([closedConnectionError], { n: 12n });
    const result = await countSubscribedEvents(db as never, ["user"], ["user:created"]);
    expect(result).toBe(12n);
    expect(db.calls).toBe(2);
  });

  test("gives up after exhausting pool-bounded retries (max: 1 → 3 total calls)", async () => {
    const db = fakeClient([closedConnectionError, closedConnectionError, closedConnectionError], {
      v: 5,
    });
    await expect(selectStreamMaxVersion(db as never, "agg1", "t1")).rejects.toBe(
      closedConnectionError,
    );
    expect(db.calls).toBe(3);
  });
});
