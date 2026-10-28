import { describe, expect, test } from "bun:test";
import {
  mergeChunkLookups,
  type PublishedReferenceChunk,
  referenceChunkKey,
  referenceIdChunks,
} from "../render-list-reference-columns.ts";

function chunkFor(ids: readonly string[], complete = true): PublishedReferenceChunk {
  return {
    map: new Map(ids.map((id) => [id, `Label ${id}`])),
    complete,
    idsKey: referenceChunkKey(ids),
  };
}

describe("referenceIdChunks", () => {
  test("collects single and multi values once, in first-seen order, chunked by size", () => {
    const rows = [{ ref: "b" }, { ref: ["a", "b"] }, { ref: "" }, { ref: null }, { ref: "c" }];

    expect(referenceIdChunks(rows, "ref", 2)).toEqual([["b", "a"], ["c"]]);
  });
});

describe("mergeChunkLookups", () => {
  test("every chunk resolved for the current ids is complete and carries all labels", () => {
    const merged = mergeChunkLookups([["a"], ["b"]], { 0: chunkFor(["a"]), 1: chunkFor(["b"]) });

    expect(merged?.complete).toBe(true);
    expect(merged?.pending).toBeUndefined();
    expect([...(merged?.map ?? [])]).toEqual([
      ["a", "Label a"],
      ["b", "Label b"],
    ]);
  });

  test("a chunk resolved for an earlier id set keeps its labels but proves nothing about the new ids", () => {
    const merged = mergeChunkLookups([["a", "new"]], { 0: chunkFor(["a", "old"]) });

    expect(merged?.complete).toBe(false);
    expect(merged?.pending).toBe(true);
    expect(merged?.map.get("a")).toBe("Label a");
  });

  test("a chunk still loading leaves the column incomplete", () => {
    const merged = mergeChunkLookups([["a"], ["b"]], { 0: chunkFor(["a"]) });

    expect(merged?.complete).toBe(false);
    expect(merged?.pending).toBe(true);
  });

  test("nothing resolved yet publishes no lookup", () => {
    expect(mergeChunkLookups([["a"]], undefined)).toBeUndefined();
  });
});
