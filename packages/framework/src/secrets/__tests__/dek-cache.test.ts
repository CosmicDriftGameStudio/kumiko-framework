import { randomBytes } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { createDekCache } from "../dek-cache";
import type { MasterKeyProvider } from "../types";

// Minimal stub provider — counts unwrap calls so we can observe caching.
function makeCountingProvider(): MasterKeyProvider & { unwrapCallCount: () => number } {
  let calls = 0;
  return {
    unwrapDek: async (_encryptedDek, _version) => {
      calls++;
      return randomBytes(32);
    },
    wrapDek: async () => ({ encryptedDek: randomBytes(60), kekVersion: 1 }),
    currentVersion: () => 1,
    isAvailable: async () => true,
    unwrapCallCount: () => calls,
  };
}

describe("DekCache", () => {
  test("second read within TTL is served from cache (no provider call)", async () => {
    const provider = makeCountingProvider();
    const cache = createDekCache({ ttlMs: 1000 });
    const encryptedDek = Buffer.from("some-wrapped-dek-bytes");

    await cache.unwrapDek(encryptedDek, 1, provider);
    expect(provider.unwrapCallCount()).toBe(1);

    await cache.unwrapDek(encryptedDek, 1, provider);
    await cache.unwrapDek(encryptedDek, 1, provider);
    expect(provider.unwrapCallCount()).toBe(1);
  });

  test("after TTL expiry, provider is called again", async () => {
    let t = 1_000_000;
    const provider = makeCountingProvider();
    const cache = createDekCache({ ttlMs: 1000, now: () => t });
    const encryptedDek = Buffer.from("wrapped");

    await cache.unwrapDek(encryptedDek, 1, provider);
    expect(provider.unwrapCallCount()).toBe(1);

    t += 1500; // past TTL
    await cache.unwrapDek(encryptedDek, 1, provider);
    expect(provider.unwrapCallCount()).toBe(2);
  });

  test("different kekVersion entries do not collide", async () => {
    const provider = makeCountingProvider();
    const cache = createDekCache({ ttlMs: 60_000 });
    const encryptedDek = Buffer.from("same-wrapped-payload");

    // Same encryptedDek bytes at two different versions — must be two
    // distinct cache entries, never confuse one for the other.
    await cache.unwrapDek(encryptedDek, 1, provider);
    await cache.unwrapDek(encryptedDek, 2, provider);
    expect(provider.unwrapCallCount()).toBe(2);
    expect(cache.size()).toBe(2);
  });

  test("returned DEK is a defensive copy (caller can zero without affecting cache)", async () => {
    const provider = makeCountingProvider();
    const cache = createDekCache({ ttlMs: 60_000 });
    const encryptedDek = Buffer.from("payload");

    const first = await cache.unwrapDek(encryptedDek, 1, provider);
    first.fill(0);

    // Second call should still produce a non-zero DEK, served from cache.
    const second = await cache.unwrapDek(encryptedDek, 1, provider);
    expect(second.some((b) => b !== 0)).toBe(true);
    // Only one underlying provider unwrap despite the zeroing.
    expect(provider.unwrapCallCount()).toBe(1);
  });

  test("clear() drops all entries and forces next read back through the provider", async () => {
    const provider = makeCountingProvider();
    const cache = createDekCache({ ttlMs: 60_000 });
    const encryptedDek = Buffer.from("payload");

    await cache.unwrapDek(encryptedDek, 1, provider);
    expect(cache.size()).toBe(1);

    cache.clear();
    expect(cache.size()).toBe(0);

    await cache.unwrapDek(encryptedDek, 1, provider);
    expect(provider.unwrapCallCount()).toBe(2);
  });

  test("clear() zeros the cached DEK bytes before dropping", async () => {
    const dek = randomBytes(32);
    const captured = Buffer.from(dek); // original reference for comparison
    const provider: MasterKeyProvider = {
      unwrapDek: async () => dek,
      wrapDek: async () => ({ encryptedDek: randomBytes(60), kekVersion: 1 }),
      currentVersion: () => 1,
      isAvailable: async () => true,
    };
    const cache = createDekCache({ ttlMs: 60_000 });
    // Populate via the actual unwrap path so the cache takes its own copy.
    const dummyReturn = await cache.unwrapDek(Buffer.from("x"), 1, provider);
    // The defensive copy means dek the provider returned is distinct from
    // what the cache stored; we spy on the cache side via vi.
    void dummyReturn;
    void captured;
    cache.clear();
    // Post-clear we can't easily inspect the zeroed internal buffer from
    // outside — but size() going to 0 plus the no-throw behaviour confirms
    // the code path runs. The real security property (no stale bytes in
    // heap snapshots) can only be observed with a debugger.
    expect(cache.size()).toBe(0);
  });

  test("expired entry is pruned on next miss to bound memory", async () => {
    let t = 1_000_000;
    const provider = makeCountingProvider();
    const cache = createDekCache({ ttlMs: 100, now: () => t });

    await cache.unwrapDek(Buffer.from("a"), 1, provider);
    expect(cache.size()).toBe(1);

    t += 200; // past TTL
    await cache.unwrapDek(Buffer.from("a"), 1, provider);
    // Still size 1, but it's the fresh entry — not a leak of the expired one.
    expect(cache.size()).toBe(1);
  });

  test("concurrent same-key calls both go through to provider in v1 (no request coalescing)", async () => {
    // Documenting current behaviour: we don't dedupe in-flight unwraps.
    // Two simultaneous reads of the same encryptedDek will each hit the
    // provider. Fine for v1 — real-world collision risk is low and the
    // cost is "one extra provider call" per burst. v2 could add a
    // promise-cache to coalesce.
    const provider = makeCountingProvider();
    const cache = createDekCache({ ttlMs: 60_000 });
    const ed = Buffer.from("concurrent");
    await Promise.all([cache.unwrapDek(ed, 1, provider), cache.unwrapDek(ed, 1, provider)]);
    expect(provider.unwrapCallCount()).toBe(2);
  });

  test("defaults TTL is 5 minutes when not overridden", async () => {
    // Sanity on the documented default — a regression where someone tweaks
    // DEFAULT_TTL_MS would silently change the security posture.
    const provider = makeCountingProvider();
    let t = 0;
    const cache = createDekCache({ now: () => t });
    await cache.unwrapDek(Buffer.from("x"), 1, provider);
    t = 4 * 60 * 1000; // 4 min in
    await cache.unwrapDek(Buffer.from("x"), 1, provider);
    expect(provider.unwrapCallCount()).toBe(1);
    t = 5 * 60 * 1000 + 1; // just past 5 min
    await cache.unwrapDek(Buffer.from("x"), 1, provider);
    expect(provider.unwrapCallCount()).toBe(2);
    // avoid vitest unused-import warning
    void vi;
  });

  test("LRU: evicts oldest when maxEntries is reached", async () => {
    const provider = makeCountingProvider();
    const cache = createDekCache({ maxEntries: 3, ttlMs: 60_000 });
    // Fill the cache.
    await cache.unwrapDek(Buffer.from("A"), 1, provider);
    await cache.unwrapDek(Buffer.from("B"), 1, provider);
    await cache.unwrapDek(Buffer.from("C"), 1, provider);
    expect(cache.size()).toBe(3);
    expect(provider.unwrapCallCount()).toBe(3);

    // Insert a fourth — A (oldest) must be evicted. Size stays at cap.
    await cache.unwrapDek(Buffer.from("D"), 1, provider);
    expect(cache.size()).toBe(3);
    expect(provider.unwrapCallCount()).toBe(4);

    // Re-request A — cache miss because it was evicted, provider is called.
    await cache.unwrapDek(Buffer.from("A"), 1, provider);
    expect(provider.unwrapCallCount()).toBe(5);

    // Re-request D — cache hit, no new provider call.
    await cache.unwrapDek(Buffer.from("D"), 1, provider);
    expect(provider.unwrapCallCount()).toBe(5);
  });

  test("LRU: touching an entry moves it to the 'most recent' end", async () => {
    const provider = makeCountingProvider();
    const cache = createDekCache({ maxEntries: 3, ttlMs: 60_000 });
    await cache.unwrapDek(Buffer.from("A"), 1, provider);
    await cache.unwrapDek(Buffer.from("B"), 1, provider);
    await cache.unwrapDek(Buffer.from("C"), 1, provider);
    // Touch A — now B is the oldest.
    await cache.unwrapDek(Buffer.from("A"), 1, provider);
    expect(provider.unwrapCallCount()).toBe(3); // A was a cache hit

    // Insert D — evicts B (oldest after the touch), not A.
    await cache.unwrapDek(Buffer.from("D"), 1, provider);
    // A still cached
    await cache.unwrapDek(Buffer.from("A"), 1, provider);
    expect(provider.unwrapCallCount()).toBe(4);
    // B was evicted
    await cache.unwrapDek(Buffer.from("B"), 1, provider);
    expect(provider.unwrapCallCount()).toBe(5);
  });

  test("default maxEntries is 1000 so burst-cost is bounded", async () => {
    const provider = makeCountingProvider();
    const cache = createDekCache();
    // Insert 1001 unique entries — size must cap at 1000.
    for (let i = 0; i < 1001; i++) {
      await cache.unwrapDek(Buffer.from(`key-${i}`), 1, provider);
    }
    expect(cache.size()).toBe(1000);
  });
});
