import { describe, expect, test } from "bun:test";
import { createBoundedLoadCache } from "../bounded-load-cache.ts";

describe("createBoundedLoadCache", () => {
  test("keeps two different sources side by side and reuses a cached load", async () => {
    const disposed: string[] = [];
    let loads = 0;
    const { load: get } = createBoundedLoadCache<string>(4, (value) => disposed.push(value));
    const load = (value: string) => () => {
      loads += 1;
      return Promise.resolve(value);
    };
    expect(await get("a", load("A"))).toBe("A");
    expect(await get("b", load("B"))).toBe("B");
    expect(await get("a", load("A2"))).toBe("A");
    expect(loads).toBe(2);
    expect(disposed).toEqual([]);
  });

  test("a fifth source evicts and disposes only the oldest idle one", async () => {
    const disposed: string[] = [];
    const cache = createBoundedLoadCache<string>(4, (value) => disposed.push(value));
    for (const key of ["a", "b", "c", "d"]) {
      await cache.load(key, () => Promise.resolve(key));
      cache.retain(key)();
    }
    await cache.load("e", () => Promise.resolve("e"));
    await Promise.resolve();
    expect(disposed).toEqual(["a"]);
    let reloads = 0;
    await cache.load("a", () => {
      reloads += 1;
      return Promise.resolve("a");
    });
    expect(reloads).toBe(1);
  });

  test("a retained entry is not evicted or disposed until its last user releases it", async () => {
    const disposed: string[] = [];
    const cache = createBoundedLoadCache<string>(2, (value) => disposed.push(value));
    await cache.load("a", () => Promise.resolve("a"));
    const releaseFirst = cache.retain("a");
    const releaseSecond = cache.retain("a");
    for (const key of ["b", "c"]) {
      await cache.load(key, () => Promise.resolve(key));
      cache.retain(key)();
    }
    await cache.load("d", () => Promise.resolve("d"));
    await Promise.resolve();
    expect(disposed).not.toContain("a");
    expect(disposed).toEqual(["b", "c"]);

    releaseFirst();
    await Promise.resolve();
    expect(disposed).not.toContain("a");

    releaseSecond();
    await cache.load("e", () => Promise.resolve("e"));
    await Promise.resolve();
    expect(disposed).toEqual(["b", "c", "a"]);
  });

  test("documents loaded in one commit survive until their consumers have retained them", async () => {
    const disposed: string[] = [];
    const cache = createBoundedLoadCache<string>(4, (value) => disposed.push(value));
    const keys = ["a", "b", "c", "d", "e"];
    await Promise.all(keys.map((key) => cache.load(key, () => Promise.resolve(key))));
    await Promise.resolve();
    expect(disposed).toEqual([]);

    for (const key of keys) cache.retain(key);
    await Promise.resolve();
    expect(disposed).toEqual([]);
  });

  test("entries nobody ever retained are still bounded at twice the maximum", async () => {
    const disposed: string[] = [];
    const cache = createBoundedLoadCache<string>(2, (value) => disposed.push(value));
    for (const key of ["a", "b", "c", "d", "e"]) {
      await cache.load(key, () => Promise.resolve(key));
    }
    await Promise.resolve();
    expect(disposed).toEqual(["a"]);
  });

  test("a handled failure that shouldKeep rejects is retried on the next call", async () => {
    type Result = { readonly ok: boolean };
    const { load: get } = createBoundedLoadCache<Result>(
      4,
      () => {},
      (result) => result.ok,
    );
    expect(await get("doc", () => Promise.resolve({ ok: false }))).toEqual({ ok: false });
    await Promise.resolve();
    expect(await get("doc", () => Promise.resolve({ ok: true }))).toEqual({ ok: true });
    let reloads = 0;
    await get("doc", () => {
      reloads += 1;
      return Promise.resolve({ ok: true });
    });
    expect(reloads).toBe(0);
  });
});
