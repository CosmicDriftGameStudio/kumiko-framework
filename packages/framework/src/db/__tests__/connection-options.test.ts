import { describe, expect, test } from "vitest";
import { dbConnectionOptionsFromEnv } from "../connection";

// createDbConnection itself opens a real postgres.js socket, so it's
// exercised in the DB-integration suite. The env-parsing + validation
// logic is pure and worth pinning as a unit — misconfig at boot is the
// whole point of parsing strictly.

describe("dbConnectionOptionsFromEnv", () => {
  test("empty env → empty options (falls back to postgres.js defaults)", () => {
    expect(dbConnectionOptionsFromEnv({})).toEqual({});
  });

  test("reads all three supported keys", () => {
    const opts = dbConnectionOptionsFromEnv({
      DATABASE_POOL_MAX: "25",
      DATABASE_POOL_IDLE_TIMEOUT: "60",
      DATABASE_POOL_CONNECT_TIMEOUT: "5",
    });
    expect(opts).toEqual({
      maxConnections: 25,
      idleTimeoutSeconds: 60,
      connectTimeoutSeconds: 5,
    });
  });

  test("empty string is treated as unset", () => {
    const opts = dbConnectionOptionsFromEnv({
      DATABASE_POOL_MAX: "",
      DATABASE_POOL_IDLE_TIMEOUT: "30",
    });
    expect(opts).toEqual({ idleTimeoutSeconds: 30 });
  });

  test("zero is allowed (idle_timeout=0 disables idle eviction in postgres.js)", () => {
    const opts = dbConnectionOptionsFromEnv({
      DATABASE_POOL_IDLE_TIMEOUT: "0",
    });
    expect(opts).toEqual({ idleTimeoutSeconds: 0 });
  });

  test("negative number → throws (misconfig catches at boot)", () => {
    expect(() => dbConnectionOptionsFromEnv({ DATABASE_POOL_MAX: "-5" })).toThrow(
      /DATABASE_POOL_MAX="-5".*non-negative/i,
    );
  });

  test("non-numeric → throws", () => {
    expect(() => dbConnectionOptionsFromEnv({ DATABASE_POOL_CONNECT_TIMEOUT: "five" })).toThrow(
      /DATABASE_POOL_CONNECT_TIMEOUT="five"/,
    );
  });

  test("decimal → throws (postgres.js expects integer seconds)", () => {
    expect(() => dbConnectionOptionsFromEnv({ DATABASE_POOL_IDLE_TIMEOUT: "1.5" })).toThrow(
      /DATABASE_POOL_IDLE_TIMEOUT="1.5".*integer/i,
    );
  });

  test("unrelated env vars are ignored", () => {
    const opts = dbConnectionOptionsFromEnv({
      HOME: "/home/user",
      PATH: "/usr/bin",
      DATABASE_POOL_MAX: "10",
    });
    expect(opts).toEqual({ maxConnections: 10 });
  });
});
