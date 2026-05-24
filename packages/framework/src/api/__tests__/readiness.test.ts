import { describe, expect, test } from "bun:test";
import { createReadinessProbe, type ReadinessCheck } from "../readiness";

function okCheck(name: string, delayMs = 0): ReadinessCheck {
  return {
    name,
    run: async () => {
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    },
  };
}

function failCheck(name: string, message: string): ReadinessCheck {
  return {
    name,
    run: async () => {
      throw new Error(message);
    },
  };
}

function hangCheck(name: string): ReadinessCheck {
  return {
    name,
    run: () => new Promise(() => {}),
  };
}

describe("createReadinessProbe", () => {
  test("all checks pass → ok=true", async () => {
    const probe = createReadinessProbe([okCheck("a"), okCheck("b")]);
    const result = await probe();
    expect(result.ok).toBe(true);
    expect(result.checks).toHaveLength(2);
    expect(result.checks.every((c) => c.ok)).toBe(true);
  });

  test("one failing check drags the whole probe down", async () => {
    const probe = createReadinessProbe([okCheck("db"), failCheck("redis", "ECONNREFUSED")]);
    const result = await probe();
    expect(result.ok).toBe(false);
    expect(result.checks).toHaveLength(2);
    const redis = result.checks.find((c) => c.name === "redis");
    expect(redis?.ok).toBe(false);
    expect(redis?.error).toContain("ECONNREFUSED");
  });

  test("hung check is aborted at timeoutMs and surfaces as failure", async () => {
    const probe = createReadinessProbe([hangCheck("slow"), okCheck("fast")], { timeoutMs: 50 });
    const start = performance.now();
    const result = await probe();
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(500); // far below the hang's infinity
    expect(result.ok).toBe(false);
    const slow = result.checks.find((c) => c.name === "slow");
    expect(slow?.ok).toBe(false);
    expect(slow?.error).toMatch(/timeout/i);
  });

  test("checks run in parallel — total latency ≈ slowest, not sum", async () => {
    const probe = createReadinessProbe([okCheck("a", 80), okCheck("b", 80), okCheck("c", 80)]);
    const start = performance.now();
    const result = await probe();
    const elapsed = performance.now() - start;
    expect(result.ok).toBe(true);
    // Parallel: ~80ms total. Sequential would be ~240ms. Generous margin for CI.
    expect(elapsed).toBeLessThan(200);
  });

  test("empty check list → ok=true, empty results", async () => {
    const probe = createReadinessProbe([]);
    const result = await probe();
    expect(result.ok).toBe(true);
    expect(result.checks).toHaveLength(0);
  });
});
