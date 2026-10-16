import { describe, expect, test } from "bun:test";
import { BunAuditUnavailableError, retryWhileUnavailable } from "../_lib/security-audit";

function unavailable(): BunAuditUnavailableError {
  return new BunAuditUnavailableError(new Uint8Array(), new Uint8Array(), 0);
}

describe("retryWhileUnavailable", () => {
  test("3 Fehlversuche → Fehler nach 3 Attempts", async () => {
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

  test("Erfolg im 2. Versuch → Ergebnis + genau 1 Sleep", async () => {
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

  test("Nicht-Unavailable-Fehler → 1 Attempt, kein Retry", async () => {
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

  test("Timeout-Budget erschöpft vor einem Versuch → Fehler ohne weiteren Call", async () => {
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

  test("schneller Fehlschlag laesst dem naechsten Versuch fast das ganze Budget, nicht ein Drittel", async () => {
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

  test("ein haengender Versuch verbraucht das gesamte Budget → kein weiterer Versuch", async () => {
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

  test("Budget erschöpft → stderr der letzten Unavailable-Error bleibt in der Fehlermeldung", async () => {
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

  test("Timeout-bedingter Kill zeigt in der Meldung als Timeout, nicht als Netzwerkfehler", async () => {
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
