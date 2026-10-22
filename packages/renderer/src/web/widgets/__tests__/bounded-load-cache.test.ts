import { describe, expect, test } from "bun:test";
import { createBoundedLoadCache } from "../bounded-load-cache.ts";

describe("createBoundedLoadCache", () => {
  test("keeps two different sources side by side and reuses a cached load", async () => {
    const disposed: string[] = [];
    let loads = 0;
    const get = createBoundedLoadCache<string>(4, (value) => disposed.push(value));
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

  test("a fifth source evicts and disposes only the oldest", async () => {
    const disposed: string[] = [];
    const get = createBoundedLoadCache<string>(4, (value) => disposed.push(value));
    for (const key of ["a", "b", "c", "d", "e"]) await get(key, () => Promise.resolve(key));
    await Promise.resolve();
    expect(disposed).toEqual(["a"]);
    let reloads = 0;
    await get("a", () => {
      reloads += 1;
      return Promise.resolve("a");
    });
    expect(reloads).toBe(1);
  });

  test("a handled failure that shouldKeep rejects is retried on the next call", async () => {
    type Result = { readonly ok: boolean };
    const get = createBoundedLoadCache<Result>(
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
