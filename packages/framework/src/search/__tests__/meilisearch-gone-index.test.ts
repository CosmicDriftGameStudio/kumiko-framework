import { describe, expect, test } from "bun:test";
import {
  type IndexListingClient,
  isGoneIndexError,
  listIndexUids,
} from "../meilisearch-adapter.ts";

describe("isGoneIndexError", () => {
  test("an index a concurrent drop already deleted counts as gone", () => {
    expect(isGoneIndexError({ code: "index_not_found", message: "Index `t_1` not found." })).toBe(
      true,
    );
  });

  test("index files that vanished under the delete count as gone", () => {
    expect(
      isGoneIndexError({ code: "internal", message: "No such file or directory (os error 2)" }),
    ).toBe(true);
  });

  test("any other failure is not swallowed", () => {
    expect(isGoneIndexError({ code: "internal", message: "disk full" })).toBe(false);
    expect(isGoneIndexError(undefined)).toBe(false);
    expect(isGoneIndexError(null)).toBe(false);
  });
});

function listingError(message: string): Error {
  return new Error("listing failed", { cause: { code: "internal", message } });
}

function fakeClient(firstListing: Error | undefined): {
  client: IndexListingClient;
  calls: string[];
} {
  const calls: string[] = [];
  let listings = 0;
  const client: IndexListingClient = {
    async getIndexes() {
      listings += 1;
      calls.push(`list ${listings}`);
      if (listings === 1 && firstListing) throw firstListing;
      return { results: [{ uid: "app_t1" }, { uid: "app_t2" }], total: 2 };
    },
    tasks: {
      async getTasks(query) {
        calls.push(`pending ${query.types.join()} ${query.statuses.join()}`);
        return { results: [{ uid: 41 }, { uid: 42 }] };
      },
      async waitForTasks(taskUids) {
        calls.push(`wait ${taskUids.join()}`);
        return [];
      },
    },
  };
  return { client, calls };
}

describe("listIndexUids", () => {
  test("a clean listing reads once", async () => {
    const { client, calls } = fakeClient(undefined);
    expect(await listIndexUids(client)).toEqual(["app_t1", "app_t2"]);
    expect(calls).toEqual(["list 1"]);
  });

  test("a listing that meets a concurrent deletion waits for the deletions, then reads again", async () => {
    const { client, calls } = fakeClient(
      listingError("Index `abc`: No such file or directory (os error 2)"),
    );
    expect(await listIndexUids(client)).toEqual(["app_t1", "app_t2"]);
    expect(calls).toEqual([
      "list 1",
      "pending indexDeletion enqueued,processing",
      "wait 41,42",
      "list 2",
    ]);
  });

  test("any other listing failure is thrown without a second read", async () => {
    const { client, calls } = fakeClient(listingError("disk full"));
    await expect(listIndexUids(client)).rejects.toThrow("listing failed");
    expect(calls).toEqual(["list 1"]);
  });
});
