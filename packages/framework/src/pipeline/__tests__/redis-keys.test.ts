import { describe, expect, test } from "bun:test";
import { RedisKeys } from "../redis-keys";

describe("RedisKeys", () => {
  test("uses unique kumiko-prefixed namespaces", () => {
    const values = Object.values(RedisKeys);
    expect(new Set(values).size).toBe(values.length);
    for (const key of values) {
      expect(key.startsWith("kumiko:")).toBe(true);
    }
  });
});
