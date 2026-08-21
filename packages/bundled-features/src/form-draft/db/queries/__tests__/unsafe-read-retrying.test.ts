// #2323: draft-count.ts, owned-file-refs.ts and cleanup.ts read form-draft
// rows via asRawClient(db).unsafe() directly, bypassing the #1163
// closed-connection retry that only covered bun-db/query.ts's own
// selectMany/countWhere. Routed the SELECT-only call sites through
// unsafeReadRetrying instead — this test mirrors
// bun-db/__tests__/select-many-retry.test.ts's fake-client pattern to prove
// the retry now actually fires for each call site.

import { describe, expect, test } from "bun:test";
import { Temporal } from "temporal-polyfill";
import { selectStaleDraftsBatch } from "../cleanup";
import { countDraftsByOwner } from "../draft-count";
import { filterOwnedFileRefs } from "../owned-file-refs";

function closedConnectionError(): Error {
  return Object.assign(new Error("The connection was closed."), { name: "AbortError" });
}

type FakeClient = {
  unsafe: (sql: string, params?: readonly unknown[]) => Promise<readonly unknown[]>;
  begin: () => never;
  calls: number;
};

function fakeClient(failures: Error[], row: Record<string, unknown>): FakeClient {
  const remaining = [...failures];
  const client: FakeClient = {
    calls: 0,
    unsafe: async () => {
      client.calls++;
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

describe("form-draft db/queries — closed-connection retry (#2323)", () => {
  test("countDraftsByOwner retries once and returns the count", async () => {
    const db = fakeClient([closedConnectionError()], { count: 4 });
    const result = await countDraftsByOwner(db as never, "t1" as never, "owner1");
    expect(result).toBe(4);
    expect(db.calls).toBe(2);
  });

  test("filterOwnedFileRefs retries once and returns rows", async () => {
    const db = fakeClient([closedConnectionError()], { id: "ref1", storage_key: "key1" });
    const rows = await filterOwnedFileRefs(
      db as never,
      "t1" as never,
      "owner1",
      ["key1"],
      Temporal.Now.instant(),
      false,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.storageKey).toBe("key1");
    expect(db.calls).toBe(2);
  });

  test("selectStaleDraftsBatch retries once and returns rows", async () => {
    const db = fakeClient([closedConnectionError()], {
      id: "d1",
      tenant_id: "t1",
      owner_id: "owner1",
      draft_key: "screen:1",
      draft: {},
      inserted_at: new Date("2026-01-01T00:00:00Z"),
    });
    const rows = await selectStaleDraftsBatch(db as never, 30, 10);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("d1");
    expect(db.calls).toBe(2);
  });

  test("gives up after the single retry when the connection stays closed", async () => {
    const db = fakeClient([closedConnectionError(), closedConnectionError()], { count: 4 });
    await expect(countDraftsByOwner(db as never, "t1" as never, "owner1")).rejects.toThrow(
      "connection was closed",
    );
    expect(db.calls).toBe(2);
  });
});
