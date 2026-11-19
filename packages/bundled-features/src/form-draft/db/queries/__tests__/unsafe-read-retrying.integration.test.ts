// draft-count.ts, owned-file-refs.ts and cleanup.ts read form-draft rows
// through unsafeReadRetrying; this proves the retry fires per call site
// using a real captured driver error.

import { beforeAll, describe, expect, test } from "bun:test";
import {
  captureClosedConnectionError,
  fakePooledClientFailingWith,
} from "@cosmicdrift/kumiko-testing/helpers";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { selectStaleDraftsBatch } from "../cleanup.ts";
import { countDraftsByOwner } from "../draft-count.ts";
import { filterOwnedFileRefs } from "../owned-file-refs.ts";

let closedConnectionError: unknown;

beforeAll(async () => {
  closedConnectionError = await captureClosedConnectionError();
});

describe("form-draft db/queries — closed-connection retry", () => {
  test("countDraftsByOwner retries once and returns the count", async () => {
    const db = fakePooledClientFailingWith([closedConnectionError], { count: 4 });
    const result = await countDraftsByOwner(db, "t1", "owner1");
    expect(result).toBe(4);
    expect(db.calls).toHaveLength(2);
  });

  test("filterOwnedFileRefs retries once and returns rows", async () => {
    const db = fakePooledClientFailingWith([closedConnectionError], {
      id: "ref1",
      storage_key: "key1",
    });
    const rows = await filterOwnedFileRefs(
      db,
      "t1",
      "owner1",
      ["key1"],
      Temporal.Now.instant(),
      false,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.storageKey).toBe("key1");
    expect(db.calls).toHaveLength(2);
  });

  test("selectStaleDraftsBatch retries once and returns rows", async () => {
    const db = fakePooledClientFailingWith([closedConnectionError], {
      id: "d1",
      tenant_id: "t1",
      owner_id: "owner1",
      draft_key: "screen:1",
      draft: {},
      inserted_at: new Date("2026-01-01T00:00:00Z"),
    });
    const rows = await selectStaleDraftsBatch(db, 30, 10);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("d1");
    expect(db.calls).toHaveLength(2);
  });
});
