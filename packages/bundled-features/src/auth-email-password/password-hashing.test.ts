import { describe, expect, test } from "bun:test";
import { hashPassword, verifyDummyPassword, verifyPassword } from "./password-hashing";

const medianMs = async (fn: () => Promise<unknown>, runs = 5): Promise<number> => {
  const samples: number[] = [];
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    await fn();
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)] ?? 0;
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

    const realMs = await medianMs(() => verifyPassword(realHash, "wrong-password"));
    const dummyMs = await medianMs(() => verifyDummyPassword("wrong-password"));

    // A skipped miss-path (the bug) is sub-millisecond; a real argon2 verify
    // is ~20ms. A half-of-real floor is a wide, non-flaky bound that still
    // fails hard if the dummy verify is ever removed.
    expect(dummyMs).toBeGreaterThan(realMs * 0.5);
  });
});
