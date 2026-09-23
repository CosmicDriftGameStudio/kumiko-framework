// draft-count.ts, owned-file-refs.ts and cleanup.ts read form-draft rows
// through unsafeReadRetrying; this proves the retry fires per call site
// using a real captured driver error.

import { beforeAll, describe, expect, test } from "bun:test";
import { captureClosedConnectionError } from "@cosmicdrift/kumiko-framework/testing";
import { Temporal } from "temporal-polyfill";
import { selectStaleDraftsBatch } from "../cleanup";
import { countDraftsByOwner } from "../draft-count";
import { filterOwnedFileRefs } from "../owned-file-refs";

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

function fakeClient(failures: unknown[], row: Record<string, unknown>): FakeClient {
  const remaining = [...failures];
  const client: FakeClient = {
    calls: 0,
    options: { max: 1 },
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

describe("form-draft db/queries — closed-connection retry", () => {
  test("countDraftsByOwner retries once and returns the count", async () => {
    const db = fakeClient([closedConnectionError], { count: 4 });
    const result = await countDraftsByOwner(db as never, "t1" as never, "owner1");
    expect(result).toBe(4);
    expect(db.calls).toBe(2);
  });

  test("filterOwnedFileRefs retries once and returns rows", async () => {
    const db = fakeClient([closedConnectionError], { id: "ref1", storage_key: "key1" });
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
    const db = fakeClient([closedConnectionError], {
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

  test("gives up after exhausting pool-bounded retries (max: 1 → 3 total calls)", async () => {
    const db = fakeClient([closedConnectionError, closedConnectionError, closedConnectionError], {
      count: 4,
    });
    await expect(countDraftsByOwner(db as never, "t1" as never, "owner1")).rejects.toBe(
      closedConnectionError,
    );
    expect(db.calls).toBe(3);
  });
});
