// #2323: stream-tenant-backfill.ts's candidate scan (a plain, non-transactional
// SELECT) read via asRawClient(db).unsafe() directly, bypassing the #1163
// closed-connection retry. Routed it through unsafeReadRetrying instead — this
// test mirrors bun-db/__tests__/select-many-retry.test.ts's fake-client
// pattern to prove the retry now fires. migrateAggregate's per-aggregate
// SELECT ... FOR UPDATE stays out of scope: it runs inside transaction(),
// where the retry guard (no begin() on a tx handle) is a no-op by design.

import { describe, expect, test } from "bun:test";
import { backfillUserStreamTenants } from "../stream-tenant-backfill";

function closedConnectionError(): Error {
  return Object.assign(new Error("The connection was closed."), { name: "AbortError" });
}

type FakeClient = {
  unsafe: (sql: string, params?: readonly unknown[]) => Promise<readonly unknown[]>;
  begin: () => never;
  calls: number;
};

function fakeClient(failures: Error[]): FakeClient {
  const remaining = [...failures];
  const client: FakeClient = {
    calls: 0,
    unsafe: async () => {
      client.calls++;
      const err = remaining.shift();
      if (err) throw err;
      return [];
    },
    begin: () => {
      throw new Error("not used in test");
    },
  };
  return client;
}

describe("user db/queries — closed-connection retry (#2323)", () => {
  test("backfillUserStreamTenants retries the candidate scan once and completes with no candidates", async () => {
    const db = fakeClient([closedConnectionError()]);
    const result = await backfillUserStreamTenants(db as never);
    expect(result).toEqual({ aggregatesMigrated: 0, eventsMigrated: 0, failed: [] });
    expect(db.calls).toBe(2);
  });

  test("gives up after the single retry when the connection stays closed", async () => {
    const db = fakeClient([closedConnectionError(), closedConnectionError()]);
    await expect(backfillUserStreamTenants(db as never)).rejects.toThrow("connection was closed");
    expect(db.calls).toBe(2);
  });
});
