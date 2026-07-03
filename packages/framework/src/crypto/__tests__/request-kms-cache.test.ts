import { describe, expect, test } from "bun:test";
import { InMemoryKmsAdapter } from "../in-memory-kms-adapter";
import {
  KeyErasedError,
  type KmsContext,
  type LocalKeyKmsAdapter,
  type SubjectId,
} from "../kms-adapter";
import { createRequestKmsCache } from "../request-kms-cache";

const ctx: KmsContext = { requestId: "cache-test" };
const userA: SubjectId = { kind: "user", userId: "6b2f4a0e-1c9d-4f3a-9d2e-0000000000aa" };

function countingAdapter(): { adapter: LocalKeyKmsAdapter; calls: () => number } {
  const inner = new InMemoryKmsAdapter();
  let getKeyCalls = 0;
  const adapter: LocalKeyKmsAdapter = {
    capabilities: { mode: "local-key" },
    createKey: (subject) => inner.createKey(subject),
    eraseKey: (subject) => inner.eraseKey(subject),
    health: () => inner.health(),
    getKey: (subject) => {
      getKeyCalls++;
      return inner.getKey(subject);
    },
  };
  return { adapter, calls: () => getKeyCalls };
}

describe("createRequestKmsCache", () => {
  test("second getKey for the same subject is served from cache", async () => {
    const { adapter, calls } = countingAdapter();
    await adapter.createKey(userA, ctx);
    const cache = createRequestKmsCache(adapter);

    const first = await cache.getKey(userA, ctx);
    const second = await cache.getKey(userA, ctx);
    expect(first.equals(second)).toBe(true);
    expect(calls()).toBe(1);
  });

  test("invalidate drops the entry — next getKey hits the adapter again", async () => {
    const { adapter, calls } = countingAdapter();
    await adapter.createKey(userA, ctx);
    const cache = createRequestKmsCache(adapter);

    await cache.getKey(userA, ctx);
    cache.invalidate(userA);
    await cache.getKey(userA, ctx);
    expect(calls()).toBe(2);
  });

  test("erase + invalidate surfaces KeyErasedError instead of a stale DEK", async () => {
    const { adapter } = countingAdapter();
    await adapter.createKey(userA, ctx);
    const cache = createRequestKmsCache(adapter);

    await cache.getKey(userA, ctx);
    await adapter.eraseKey(userA, ctx);
    cache.invalidate(userA);
    await expect(cache.getKey(userA, ctx)).rejects.toBeInstanceOf(KeyErasedError);
  });

  test("adapter errors are not cached — a failed lookup retries", async () => {
    const { adapter, calls } = countingAdapter();
    const cache = createRequestKmsCache(adapter);

    await expect(cache.getKey(userA, ctx)).rejects.toThrow();
    await adapter.createKey(userA, ctx);
    const dek = await cache.getKey(userA, ctx);
    expect(dek.length).toBe(32);
    expect(calls()).toBe(2);
  });
});
