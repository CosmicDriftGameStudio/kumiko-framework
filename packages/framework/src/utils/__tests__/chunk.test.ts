import { describe, expect, test } from "bun:test";
import { chunk } from "../chunk.ts";

describe("chunk", () => {
  test("empty input yields no chunks", () => {
    expect(chunk([], 3)).toEqual([]);
  });

  test("exact multiple splits into equal chunks", () => {
    expect(chunk([1, 2, 3, 4], 2)).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  test("remainder ends up in a shorter last chunk", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  test("size larger than input yields one chunk", () => {
    expect(chunk([1, 2], 10)).toEqual([[1, 2]]);
  });
});
