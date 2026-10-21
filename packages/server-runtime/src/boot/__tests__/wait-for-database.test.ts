import { describe, expect, test } from "bun:test";
import {
  isTransientConnectionError,
  WAIT_FOR_DATABASE_DEADLINE_MS,
  waitUntilDatabaseReachable,
} from "../wait-for-database";

function pgError(code: string): Error {
  return Object.assign(new Error(`failure ${code}`), { code });
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
    "CONNECTION_CLOSED",
    "CONNECT_TIMEOUT",
    "CONNECTION_DESTROYED",
  ])("%s is transient", (code) => {
    expect(isTransientConnectionError(pgError(code))).toBe(true);
  });

  test.each(["28P01", "3D000", "42P01"])("%s is not transient", (code) => {
    expect(isTransientConnectionError(pgError(code))).toBe(false);
  });

  test("recognizes plain Node and postgres.js error shapes", () => {
    expect(isTransientConnectionError({ code: "ECONNREFUSED" })).toBe(true);
    expect(isTransientConnectionError({ code: "53300" })).toBe(true);
  });

  test("finds the code on a wrapped cause", () => {
    expect(isTransientConnectionError(new Error("wrap", { cause: pgError("53300") }))).toBe(true);
  });

  test("errors without a code are not transient", () => {
    expect(isTransientConnectionError(new Error("boom"))).toBe(false);
  });
});

describe("waitUntilDatabaseReachable", () => {
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
