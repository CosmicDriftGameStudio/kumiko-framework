import { describe, expect, test } from "bun:test";
import { MAX_LIST_LIMIT } from "@cosmicdrift/kumiko-framework/engine";
import { referenceRowsByIdsPayload, storedReferenceRowsPayload } from "../use-reference-lookup.ts";

const manyIds = Array.from({ length: MAX_LIST_LIMIT + 1 }, (_, index) => `id-${index}`);

describe("by-id reference lookup payload", () => {
  test("never asks for more rows than the server list limit allows", () => {
    expect(referenceRowsByIdsPayload(manyIds, 50)["limit"]).toBe(MAX_LIST_LIMIT);
    expect(storedReferenceRowsPayload({ refOptionsQuery: "x:query:y" }, manyIds, 50)["limit"]).toBe(
      MAX_LIST_LIMIT,
    );
  });

  test("a few ids keep the cap-sized page", () => {
    expect(referenceRowsByIdsPayload(["a"], 50)["limit"]).toBe(50);
  });
});
