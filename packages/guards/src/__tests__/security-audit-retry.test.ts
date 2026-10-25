import { describe, expect, test } from "bun:test";
import { BunAuditUnavailableError, retryWhileUnavailable } from "../_lib/security-audit";

function unavailable(): BunAuditUnavailableError {
  return new BunAuditUnavailableError(new Uint8Array(), new Uint8Array(), 0);
}

describe("retryWhileUnavailable", () => {
  test("3 failed attempts → error after 3 attempts", async () => {
    let calls = 0;
    await expect(
      retryWhileUnavailable(
        async () => {
          calls++;
          throw unavailable();
        },
        { attempts: 3, delayMs: 10, timeoutMs: 60_000, sleep: async () => {} },
      ),
    ).rejects.toBeInstanceOf(BunAuditUnavailableError);
    expect(calls).toBe(3);
  });

  test("Success on the 2nd attempt → result + exactly 1 sleep", async () => {
    let calls = 0;
    let sleeps = 0;
    const result = await retryWhileUnavailable(
      async () => {
        calls++;
        if (calls < 2) throw unavailable();
        return "ok";
      },
      {
        attempts: 3,
        delayMs: 10,
        timeoutMs: 60_000,
        sleep: async () => {
          sleeps++;
        },
      },
    );
    expect(result).toBe("ok");
    expect(calls).toBe(2);
    expect(sleeps).toBe(1);
  });

  test("Non-Unavailable error → 1 attempt, no retry", async () => {
    let calls = 0;
    await expect(
      retryWhileUnavailable(
        async () => {
          calls++;
          throw new Error("real parse error");
        },
        { attempts: 3, delayMs: 10, timeoutMs: 60_000, sleep: async () => {} },
      ),
    ).rejects.toThrow("real parse error");
    expect(calls).toBe(1);
  });

  test("Timeout budget exhausted before an attempt → error without another call", async () => {
    let calls = 0;
    let now = 0;
    await expect(
      retryWhileUnavailable(
        async () => {
          calls++;
          now += 100_000;
          throw unavailable();
        },
        { attempts: 3, delayMs: 10, timeoutMs: 50_000, now: () => now, sleep: async () => {} },
      ),
    ).rejects.toThrow(/timeout budget/);
    expect(calls).toBe(1);
  });

  test("a quick failure leaves the next attempt nearly the entire budget, not a third", async () => {
    const timeoutMs = 90_000;
    let now = 0;
    const receivedBudgets: number[] = [];
    await expect(
      retryWhileUnavailable(
        async (budgetMs) => {
          receivedBudgets.push(budgetMs);
          now += 1_000; // fails fast, like a 503
          throw unavailable();
        },
        { attempts: 3, delayMs: 0, timeoutMs, now: () => now, sleep: async () => {} },
      ),
    ).rejects.toBeInstanceOf(BunAuditUnavailableError);
    expect(receivedBudgets).toEqual([90_000, 89_000, 88_000]);
  });

  test("a hanging attempt consumes the entire budget → no further attempt", async () => {
    const timeoutMs = 90_000;
    let now = 0;
    let calls = 0;
    await expect(
      retryWhileUnavailable(
        async (budgetMs) => {
          calls++;
          now += budgetMs; // hangs for its whole allotted budget
          throw unavailable();
        },
        {
          attempts: 3,
          delayMs: 0,
          timeoutMs,
          now: () => now,
          sleep: async (ms) => {
            now += ms;
          },
        },
      ),
    ).rejects.toThrow(/timeout budget/);
    expect(calls).toBe(1);
    expect(now).toBeLessThanOrEqual(timeoutMs);
  });

  test("Budget exhausted → stderr from the last Unavailable error remains in the error message", async () => {
    let calls = 0;
    let now = 0;
    const stderrText =
      "error: POST https://registry.npmjs.org/-/npm/v1/security/advisories/bulk - 503";
    await expect(
      retryWhileUnavailable(
        async () => {
          calls++;
          now += 5_000;
          throw new BunAuditUnavailableError(
            new Uint8Array(),
            new TextEncoder().encode(stderrText),
            1,
          );
        },
        { attempts: 3, delayMs: 0, timeoutMs: 5_000, now: () => now, sleep: async () => {} },
      ),
    ).rejects.toThrow(/503/);
    expect(calls).toBe(1);
  });

  test("Timeout-caused kill is shown in the message as a timeout, not a network error", async () => {
    let error: unknown;
    try {
      await retryWhileUnavailable(
        async () => {
          throw new BunAuditUnavailableError(new Uint8Array(), new Uint8Array(), undefined, 45_000);
        },
        { attempts: 1, delayMs: 0, timeoutMs: 60_000, sleep: async () => {} },
      );
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(BunAuditUnavailableError);
    const message = (error as Error).message;
    expect(message).toMatch(/killed after exceeding its 45000ms timeout/);
    expect(message).not.toMatch(/network\/registry/);
  });
});
