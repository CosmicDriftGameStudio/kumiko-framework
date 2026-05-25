import { describe, expect, test } from "bun:test";
import { parseJsonOrThrow, parseJsonSafe } from "../safe-json";

describe("parseJsonSafe", () => {
  test("parses valid JSON", () => {
    expect(parseJsonSafe<{ a: number } | null>('{"a":1}', null)).toEqual({ a: 1 });
  });

  test("returns fallback on invalid JSON", () => {
    expect(parseJsonSafe("{bad", { ok: false })).toEqual({ ok: false });
  });
});

describe("parseJsonOrThrow", () => {
  test("parses valid JSON", () => {
    expect(parseJsonOrThrow<number[]>("[1,2]", "test")).toEqual([1, 2]);
  });

  test("throws with context on invalid JSON", () => {
    expect(() => parseJsonOrThrow("{", "roles column")).toThrow(/Invalid JSON in roles column/);
  });
});
