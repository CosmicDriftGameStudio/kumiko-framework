import type { Redis } from "ioredis";

type FakeRedisMethod = "get" | "set" | "del" | "mget" | "incr" | "expire";

export type RecordedRedisCall = { readonly method: FakeRedisMethod; readonly args: unknown[] };

const FAKE_REDIS_METHODS: readonly FakeRedisMethod[] = [
  "get",
  "set",
  "del",
  "mget",
  "incr",
  "expire",
];

// Records every call (method + args) so tests can assert on the raw Redis key
// strings; `results` supplies the value each method resolves to.
export function createRecordingRedisFake(results: Record<FakeRedisMethod, unknown>): {
  readonly redis: Redis;
  readonly calls: RecordedRedisCall[];
} {
  const calls: RecordedRedisCall[] = [];
  const methods = Object.fromEntries(
    FAKE_REDIS_METHODS.map((method) => [
      method,
      async (...args: unknown[]) => {
        calls.push({ method, args });
        return results[method];
      },
    ]),
  );
  // @cast-boundary test-stub — only the recorded methods exist; the code under test calls nothing else
  return { redis: methods as unknown as Redis, calls };
}
