import { describe, expect, test } from "bun:test";
import {
  isTransientConnectionError,
  WAIT_FOR_DATABASE_DEADLINE_MS,
  waitUntilDatabaseReachable,
} from "../wait-for-database";

const SQLSTATE_PATTERN = /^[0-9A-Z]{5}$/;

// Bun.SQL server errors carry the SQLSTATE in `errno`; client and socket errors only a `code`.
function pgError(code: string): Error {
  const fields = SQLSTATE_PATTERN.test(code)
    ? { code: "ERR_POSTGRES_SERVER_ERROR", errno: code }
    : { code };
  return Object.assign(new Error(`failure ${code}`), fields);
}

function harness(pingResults: ReadonlyArray<Error | undefined>) {
  let clock = 0;
  let calls = 0;
  const sleeps: number[] = [];
  const logs: string[] = [];
  return {
    sleeps,
    logs,
    calls: () => calls,
    ping: async () => {
      const result = pingResults[Math.min(calls, pingResults.length - 1)];
      calls++;
      if (result) throw result;
    },
    options: {
      processName: "test-proc",
      log: (line: string) => logs.push(line),
      sleep: async (ms: number) => {
        sleeps.push(ms);
        clock += ms;
      },
      now: () => clock,
    },
  };
}

describe("isTransientConnectionError", () => {
  test.each([
    "53300",
    "57P03",
    "08006",
    "08001",
    "ECONNREFUSED",
    "ECONNRESET",
    "ETIMEDOUT",
    "ENOTFOUND",
    "EAI_AGAIN",
    "ERR_POSTGRES_CONNECTION_CLOSED",
    "ERR_POSTGRES_CONNECTION_REFUSED",
    "ERR_POSTGRES_CONNECTION_TIMEOUT",
    "ERR_POSTGRES_CONNECTION_FAILED",
  ])("%s is transient", (code) => {
    expect(isTransientConnectionError(pgError(code))).toBe(true);
  });

  test.each(["28P01", "3D000", "42P01"])("%s is not transient", (code) => {
    expect(isTransientConnectionError(pgError(code))).toBe(false);
  });

  test("recognizes plain Node and Bun.SQL error shapes", () => {
    expect(isTransientConnectionError({ code: "ECONNREFUSED" })).toBe(true);
    expect(isTransientConnectionError({ code: "ERR_POSTGRES_SERVER_ERROR", errno: "53300" })).toBe(
      true,
    );
  });

  test("finds the code on a wrapped cause", () => {
    expect(isTransientConnectionError(new Error("wrap", { cause: pgError("53300") }))).toBe(true);
  });

  test("errors without a code are not transient", () => {
    expect(isTransientConnectionError(new Error("boom"))).toBe(false);
  });
});

describe("waitUntilDatabaseReachable", () => {
  test("names the waited-for dependency in the retry log line", async () => {
    const h = harness([pgError("ECONNREFUSED"), undefined]);
    await waitUntilDatabaseReachable(h.ping, { ...h.options, target: "KMS" });
    expect(h.logs).toHaveLength(1);
    expect(h.logs[0]).toContain("[test-proc] KMS not reachable");
  });

  test("returns immediately when the database answers", async () => {
    const h = harness([undefined]);
    await waitUntilDatabaseReachable(h.ping, h.options);
    expect(h.calls()).toBe(1);
    expect(h.sleeps).toEqual([]);
  });

  test("retries transient errors with doubling backoff capped at 15s, then succeeds", async () => {
    const h = harness([
      pgError("53300"),
      pgError("ECONNREFUSED"),
      pgError("53300"),
      pgError("53300"),
      pgError("53300"),
      undefined,
    ]);
    await waitUntilDatabaseReachable(h.ping, h.options);
    expect(h.sleeps).toEqual([1_000, 2_000, 4_000, 8_000, 15_000]);
    expect(h.logs).toHaveLength(5);
    expect(h.logs[0]).toBe(
      "[test-proc] database not reachable (code 53300, attempt 1), retrying in 1000ms…",
    );
  });

  test("throws a non-transient error immediately without sleeping", async () => {
    const authError = pgError("28P01");
    const h = harness([authError, undefined]);
    await expect(waitUntilDatabaseReachable(h.ping, h.options)).rejects.toBe(authError);
    expect(h.calls()).toBe(1);
    expect(h.sleeps).toEqual([]);
  });

  test("gives up at the deadline and throws the last error", async () => {
    const lastError = pgError("53300");
    const h = harness([lastError]);
    await expect(waitUntilDatabaseReachable(h.ping, h.options)).rejects.toBe(lastError);
    const totalSlept = h.sleeps.reduce((sum, ms) => sum + ms, 0);
    expect(totalSlept).toBe(WAIT_FOR_DATABASE_DEADLINE_MS);
  });
});

describe("waitUntilDatabaseReachable shared deadline", () => {
  test("two sequential waits on one deadline sleep at most one deadline window together", async () => {
    const first = harness([pgError("ECONNREFUSED")]);
    const second = harness([pgError("ECONNREFUSED")]);
    const sleepsTogether = () => [...first.sleeps, ...second.sleeps].reduce((a, b) => a + b, 0);
    // both harnesses share one clock via the second one reading the first's progress
    let clock = 0;
    const clockedOptions = (h: ReturnType<typeof harness>) => ({
      ...h.options,
      sleep: async (ms: number) => {
        h.sleeps.push(ms);
        clock += ms;
      },
      now: () => clock,
      deadline: WAIT_FOR_DATABASE_DEADLINE_MS,
    });

    await expect(waitUntilDatabaseReachable(first.ping, clockedOptions(first))).rejects.toThrow();
    await expect(waitUntilDatabaseReachable(second.ping, clockedOptions(second))).rejects.toThrow();

    expect(sleepsTogether()).toBeLessThanOrEqual(WAIT_FOR_DATABASE_DEADLINE_MS);
    expect(second.sleeps).toEqual([]);
  });
});
