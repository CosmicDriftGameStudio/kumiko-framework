import { describe, expect, test } from "bun:test";
import type { TenantId } from "../../engine/types/identifiers";
import { createTenantTimezoneCache } from "../tenant-timezone-cache";

const tenantA = "tenant-a" as TenantId;
const tenantB = "tenant-b" as TenantId;

describe("TenantTimezoneCache", () => {
  test("miss on an unset tenant", () => {
    const cache = createTenantTimezoneCache();
    expect(cache.get(tenantA)).toBeUndefined();
  });

  test("hit returns the cached value, including a cached 'no override' (undefined)", () => {
    const cache = createTenantTimezoneCache();
    cache.set(tenantA, "Asia/Tokyo");
    cache.set(tenantB, undefined);

    expect(cache.get(tenantA)).toEqual({ value: "Asia/Tokyo" });
    // Distinct from a miss: tenantB was looked up and confirmed unset.
    expect(cache.get(tenantB)).toEqual({ value: undefined });
  });

  test("invalidate() drops only the given tenant", () => {
    const cache = createTenantTimezoneCache();
    cache.set(tenantA, "Asia/Tokyo");
    cache.set(tenantB, "Europe/Berlin");

    cache.invalidate(tenantA);

    expect(cache.get(tenantA)).toBeUndefined();
    expect(cache.get(tenantB)).toEqual({ value: "Europe/Berlin" });
  });

  test("clear() drops every tenant", () => {
    const cache = createTenantTimezoneCache();
    cache.set(tenantA, "Asia/Tokyo");
    cache.set(tenantB, "Europe/Berlin");

    cache.clear();

    expect(cache.size()).toBe(0);
    expect(cache.get(tenantA)).toBeUndefined();
    expect(cache.get(tenantB)).toBeUndefined();
  });

  test("entry expires after ttlMs", () => {
    let t = 1_000_000;
    const cache = createTenantTimezoneCache({ ttlMs: 1000, now: () => t });
    cache.set(tenantA, "Asia/Tokyo");

    expect(cache.get(tenantA)).toEqual({ value: "Asia/Tokyo" });

    t += 1500;
    expect(cache.get(tenantA)).toBeUndefined();
  });

  test("LRU: evicts oldest tenant when maxEntries is reached", () => {
    const cache = createTenantTimezoneCache({ maxEntries: 2, ttlMs: 60_000 });
    cache.set("a" as TenantId, "UTC");
    cache.set("b" as TenantId, "UTC");
    expect(cache.size()).toBe(2);

    cache.set("c" as TenantId, "UTC");
    expect(cache.size()).toBe(2);
    expect(cache.get("a" as TenantId)).toBeUndefined();
    expect(cache.get("c" as TenantId)).toEqual({ value: "UTC" });
  });

  test("LRU: touching an entry (get) moves it to the 'most recent' end", () => {
    const cache = createTenantTimezoneCache({ maxEntries: 2, ttlMs: 60_000 });
    cache.set("a" as TenantId, "UTC");
    cache.set("b" as TenantId, "UTC");
    cache.get("a" as TenantId); // touch a — b is now the oldest

    cache.set("c" as TenantId, "UTC");

    expect(cache.get("b" as TenantId)).toBeUndefined();
    expect(cache.get("a" as TenantId)).toEqual({ value: "UTC" });
  });

  test("default maxEntries is 1000", () => {
    const cache = createTenantTimezoneCache();
    for (let i = 0; i < 1001; i++) {
      cache.set(`tenant-${i}` as TenantId, "UTC");
    }
    expect(cache.size()).toBe(1000);
  });
});
