import { describe, expect, test } from "bun:test";
import { hashPassword, verifyDummyPassword, verifyPassword } from "./password-hashing.js";

const timeMs = async (fn: () => Promise<unknown>): Promise<number> => {
  const start = performance.now();
  await fn();
  return performance.now() - start;
};

const median = (samples: readonly number[]): number => {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

// #774: the login no-user path must cost the same argon2 latency as a real
// verify, otherwise response timing leaks whether an email is registered.
describe("verifyDummyPassword (anti-enumeration timing)", () => {
  test("resolves to void, never matches", async () => {
    expect(await verifyDummyPassword("whatever")).toBeUndefined();
  });

  test("burns real argon2 cost, comparable to a failed verify (not a no-op)", async () => {
    const realHash = await hashPassword("correct-horse-battery");
    // warm the lazily-cached dummy hash so we time the verify, not the one-off hash
    await verifyDummyPassword("warmup");

    // Interleaved so both paths see the same machine load: two back-to-back
    // median blocks drift apart on a busy CI runner and skew the ratio.
    const realSamples: number[] = [];
    const dummySamples: number[] = [];
    for (let i = 0; i < 7; i++) {
      realSamples.push(await timeMs(() => verifyPassword(realHash, "wrong-password")));
      dummySamples.push(await timeMs(() => verifyDummyPassword("wrong-password")));
    }
    const realMs = median(realSamples);
    const dummyMs = median(dummySamples);

    // A skipped miss-path (the bug) is sub-millisecond; a real argon2 verify
    // is ~20ms. A half-of-real floor still fails hard if the dummy verify is
    // ever removed.
    expect(dummyMs).toBeGreaterThan(realMs * 0.5);
  });
});
