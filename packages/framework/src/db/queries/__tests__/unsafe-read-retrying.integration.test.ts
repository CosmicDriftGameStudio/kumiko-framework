// event-store.ts's and projection-rebuild.ts's SELECT helpers run through
// unsafeReadRetrying; this proves the retry fires using a real captured
// driver error. Writes and the FOR UPDATE reads inside transaction() stay
// out of scope — unretried by design.

import { beforeAll, describe, expect, test } from "bun:test";
import {
  captureClosedConnectionError,
  fakePooledClientFailingWith,
} from "@cosmicdrift/kumiko-testing/helpers";
import {
  selectAggregateMaxVersion,
  selectEventsHighWaterMark,
  selectNextEventIdAfter,
  selectStreamMaxVersion,
} from "../event-store.ts";
import {
  countSubscribedEvents,
  selectEventsForProjectionRebuildBatch,
} from "../projection-rebuild.ts";

let closedConnectionError: unknown;

beforeAll(async () => {
  closedConnectionError = await captureClosedConnectionError();
});

describe("framework db/queries — closed-connection retry", () => {
  test("selectStreamMaxVersion retries once and returns the version", async () => {
    const db = fakePooledClientFailingWith([closedConnectionError], { v: 5 });
    const result = await selectStreamMaxVersion(db, "agg1", "t1");
    expect(result).toBe(5);
    expect(db.calls).toHaveLength(2);
    expect(db.calls[0]).toEqual(db.calls[1]);
  });

  test("selectAggregateMaxVersion retries once and returns the version", async () => {
    const db = fakePooledClientFailingWith([closedConnectionError], { v: 7 });
    const result = await selectAggregateMaxVersion(db, "agg1");
    expect(result).toBe(7);
    expect(db.calls).toHaveLength(2);
  });

  test("selectEventsHighWaterMark retries once and returns the max id", async () => {
    const db = fakePooledClientFailingWith([closedConnectionError], { max: 42n });
    const result = await selectEventsHighWaterMark(db);
    expect(result).toBe(42n);
    expect(db.calls).toHaveLength(2);
  });

  test("selectNextEventIdAfter retries once and returns the next id", async () => {
    const db = fakePooledClientFailingWith([closedConnectionError], { id: 43n });
    const result = await selectNextEventIdAfter(db, 42n);
    expect(result).toBe(43n);
    expect(db.calls).toHaveLength(2);
  });

  test("selectEventsForProjectionRebuildBatch retries once and returns rows", async () => {
    const db = fakePooledClientFailingWith([closedConnectionError], { id: "1", type: "created" });
    const rows = await selectEventsForProjectionRebuildBatch(
      db,
      ["user"],
      ["user:created"],
      0n,
      100,
    );
    expect(rows).toHaveLength(1);
    expect(db.calls).toHaveLength(2);
  });

  test("countSubscribedEvents retries once and returns the count", async () => {
    const db = fakePooledClientFailingWith([closedConnectionError], { n: 12n });
    const result = await countSubscribedEvents(db, ["user"], ["user:created"]);
    expect(result).toBe(12n);
    expect(db.calls).toHaveLength(2);
  });

  test("gives up after exhausting pool-bounded retries (max: 1 → 3 total calls)", async () => {
    const db = fakePooledClientFailingWith(
      [closedConnectionError, closedConnectionError, closedConnectionError],
      {
        v: 5,
      },
    );
    await expect(selectStreamMaxVersion(db, "agg1", "t1")).rejects.toBe(closedConnectionError);
    expect(db.calls).toHaveLength(3);
  });
});
