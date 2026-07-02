// In-memory cache for unwrapped DEKs. Cloud-KMS unwrap calls are expensive
// ($ + network). Caching for a short TTL amortises the cost across reads
// of the same secret. The TTL bounds the time plaintext DEKs live in the
// process — shorter is safer, longer is cheaper.
//
// Two bounds are enforced so the cache can't leak memory under adversarial
// or skewed workloads:
//   - TTL per entry (default 5min): old DEKs expire even if never reused.
//   - maxEntries (default 1000): LRU eviction kicks in on insert when full.

import { createHash } from "node:crypto";
import type { KeyScope, MasterKeyProvider } from "./types";

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_MAX_ENTRIES = 1000;

export type DekCacheOptions = {
  readonly ttlMs?: number;
  // Cap on the number of cached DEKs. On overflow, least-recently-used
  // entries are evicted (their bytes zeroed).
  readonly maxEntries?: number;
  // Injectable clock for deterministic tests.
  readonly now?: () => number;
};

export type DekCache = {
  // Unwrap via the provider, caching the result. Second call within TTL
  // returns the cached DEK without hitting the provider. The cache key is
  // (encryptedDek, kekVersion) — scope is only forwarded to the provider;
  // encryptedDek bytes are unique per value, so scoped providers can't
  // collide on the key either.
  unwrapDek(
    encryptedDek: Buffer,
    kekVersion: number,
    provider: MasterKeyProvider,
    scope?: KeyScope,
  ): Promise<Buffer>;

  // Drop every entry. Call after KEK rotation so old cached DEKs (still
  // valid, but referencing the old kekVersion) don't serve reads that
  // could otherwise detect the version change.
  clear(): void;

  // Observability: how many entries are live right now (pre-TTL-prune).
  size(): number;
};

// Wrap a provider so its unwrapDek goes through the cache. Callers keep the
// full MasterKeyProvider contract without knowing about caching —
// decryptValue handles crypto, the cache handles cost.
export function withDekCache(provider: MasterKeyProvider, cache: DekCache): MasterKeyProvider {
  return {
    wrapDek: (dek, scope) => provider.wrapDek(dek, scope),
    unwrapDek: (encryptedDek, version, scope) =>
      cache.unwrapDek(encryptedDek, version, provider, scope),
    currentVersion: () => provider.currentVersion(),
    isAvailable: () => provider.isAvailable(),
  };
}

export function createDekCache(opts: DekCacheOptions = {}): DekCache {
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  const maxEntries = opts.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const now = opts.now ?? (() => Date.now());
  // Key is a SHA-256 hash of (encryptedDek || kekVersion). Hashing avoids
  // keeping the raw wrapped bytes as the Map key (which would pin them
  // in memory) and ensures version is part of the identity — same
  // encryptedDek at different versions cannot collide.
  //
  // JS Map keeps insertion order — we exploit that for LRU: on hit we
  // delete+re-insert the entry, which moves it to the "most recent" end.
  // On overflow the first key (oldest) gets evicted.
  const entries = new Map<string, { dek: Buffer; expiresAt: number }>();

  function cacheKey(encryptedDek: Buffer, kekVersion: number): string {
    // kekVersion as 4 bytes — handles realistic rotation counts without
    // truncating (1-byte would wrap at 256, which IS achievable over a
    // decade of weekly rotations).
    const versionBuf = Buffer.alloc(4);
    versionBuf.writeUInt32BE(kekVersion);
    return createHash("sha256").update(encryptedDek).update(versionBuf).digest("hex");
  }

  function evictOldestIfFull(): void {
    // skip: under cap, no eviction needed.
    if (entries.size < maxEntries) return;
    // First key is the least-recently-inserted / least-recently-touched
    // thanks to the delete+set dance below. iterator().next() is O(1).
    const oldestKey = entries.keys().next().value;
    // skip: Map was empty mid-check — no entry to evict.
    if (oldestKey === undefined) return;
    const oldest = entries.get(oldestKey);
    if (oldest) oldest.dek.fill(0);
    entries.delete(oldestKey);
  }

  return {
    async unwrapDek(encryptedDek, kekVersion, provider, scope) {
      const key = cacheKey(encryptedDek, kekVersion);
      const hit = entries.get(key);
      if (hit && hit.expiresAt > now()) {
        // Touch: re-insert to move to the "most recent" end of the Map.
        // Without this the LRU would collapse into FIFO.
        entries.delete(key);
        entries.set(key, hit);
        // Return a copy so callers that .fill(0) after use don't wipe the
        // cached buffer for everyone else.
        return Buffer.from(hit.dek);
      }
      // Prune the expired entry on miss to bound memory.
      if (hit) {
        hit.dek.fill(0);
        entries.delete(key);
      }

      const dek = await provider.unwrapDek(encryptedDek, kekVersion, scope);
      evictOldestIfFull();
      // Store a copy — caller can zero its own buffer after use.
      entries.set(key, { dek: Buffer.from(dek), expiresAt: now() + ttlMs });
      return dek;
    },

    clear() {
      // Zero the DEK bytes before dropping references. Best-effort —
      // Node can't guarantee secure erase, but clearing now prevents
      // stale key material from lingering in heap snapshots.
      for (const { dek } of entries.values()) {
        dek.fill(0);
      }
      entries.clear();
    },

    size() {
      return entries.size;
    },
  };
}
