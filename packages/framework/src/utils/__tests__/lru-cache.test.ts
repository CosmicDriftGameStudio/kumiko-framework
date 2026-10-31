import { describe, expect, test } from "bun:test";
import { createLruCache } from "../lru-cache.ts";

describe("createLruCache", () => {
  test("evicts the least recently inserted entry beyond maxEntries", () => {
    const cache = createLruCache<string, number>({ maxEntries: 2 });
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe(2);
    expect(cache.get("c")).toBe(3);
    expect(cache.size).toBe(2);
  });

  test("a get hit makes the entry most recent", () => {
    const cache = createLruCache<string, number>({ maxEntries: 2 });
    cache.set("a", 1);
    cache.set("b", 2);
    cache.get("a");
    cache.set("c", 3);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe(1);
  });

  test("expired entries are misses and are removed", () => {
    let clock = 0;
    const cache = createLruCache<string, number>({ maxEntries: 5, ttlMs: 100, now: () => clock });
    cache.set("a", 1);
    clock = 99;
    expect(cache.get("a")).toBe(1);
    cache.set("b", 2);
    clock = 100;
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe(2);
    expect(cache.size).toBe(1);
  });

  test("a hit does not extend the TTL", () => {
    let clock = 0;
    const cache = createLruCache<string, number>({ maxEntries: 5, ttlMs: 100, now: () => clock });
    cache.set("a", 1);
    clock = 60;
    cache.get("a");
    clock = 100;
    expect(cache.get("a")).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  test("evicts oldest until the size budget holds", () => {
    const cache = createLruCache<string, string>({
      maxEntries: 10,
      maxTotalSize: 5,
      sizeOf: (value) => value.length,
    });
    cache.set("a", "11");
    cache.set("b", "22");
    cache.set("c", "4444");
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("c")).toBe("4444");
  });

  test("a value above the whole budget is never cached and drops the old value", () => {
    const cache = createLruCache<string, string>({
      maxEntries: 10,
      maxTotalSize: 3,
      sizeOf: (value) => value.length,
    });
    cache.set("a", "1");
    cache.set("a", "toolarge");
    expect(cache.get("a")).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  test("replacing a key adjusts the tracked size", () => {
    const cache = createLruCache<string, string>({
      maxEntries: 10,
      maxTotalSize: 4,
      sizeOf: (value) => value.length,
    });
    cache.set("a", "1111");
    cache.set("a", "1");
    cache.set("b", "222");
    expect(cache.get("a")).toBe("1");
    expect(cache.get("b")).toBe("222");
  });

  test("delete and clear release size", () => {
    const cache = createLruCache<string, string>({
      maxEntries: 10,
      maxTotalSize: 4,
      sizeOf: (value) => value.length,
    });
    cache.set("a", "1111");
    cache.delete("a");
    cache.set("b", "2222");
    expect(cache.get("b")).toBe("2222");
    cache.clear();
    expect(cache.size).toBe(0);
    cache.set("c", "3333");
    expect(cache.get("c")).toBe("3333");
  });
});
