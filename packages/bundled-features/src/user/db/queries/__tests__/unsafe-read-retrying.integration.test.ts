// backfillUserStreamTenants's candidate scan runs through unsafeReadRetrying;
// this proves the retry fires using a real captured driver error.
// migrateAggregate's SELECT ... FOR UPDATE stays out of scope — it runs
// inside transaction(), where the retry guard is a no-op on a tx handle.

import { beforeAll, describe, expect, test } from "bun:test";
import { captureClosedConnectionError } from "@cosmicdrift/kumiko-framework/testing";
import { backfillUserStreamTenants } from "../stream-tenant-backfill";

let closedConnectionError: unknown;

beforeAll(async () => {
  closedConnectionError = await captureClosedConnectionError();
});

type FakeClient = {
  unsafe: (sql: string, params?: readonly unknown[]) => Promise<readonly unknown[]>;
  begin: () => never;
  options: { max: number };
  calls: number;
};

function fakeClient(failures: unknown[]): FakeClient {
  const remaining = [...failures];
  const client: FakeClient = {
    calls: 0,
    options: { max: 1 },
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

describe("user db/queries — closed-connection retry", () => {
  test("backfillUserStreamTenants retries the candidate scan once and completes with no candidates", async () => {
    const db = fakeClient([closedConnectionError]);
    const result = await backfillUserStreamTenants(db as never);
    expect(result).toEqual({ aggregatesMigrated: 0, eventsMigrated: 0, failed: [] });
    expect(db.calls).toBe(2);
  });

  test("gives up after exhausting pool-bounded retries (max: 1 → 3 total calls)", async () => {
    const db = fakeClient([closedConnectionError, closedConnectionError, closedConnectionError]);
    await expect(backfillUserStreamTenants(db as never)).rejects.toBe(closedConnectionError);
    expect(db.calls).toBe(3);
  });
});
