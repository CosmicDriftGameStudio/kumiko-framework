import { describe, expect, test } from "bun:test";
import {
  DEFAULT_OUTSIDE_TRANSACTION_POOL_MAX,
  dbConnectionOptionsFromEnv,
  outsideTransactionPoolOptionsFromEnv,
} from "../connection.js";

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

  test("a removed driver selection fails instead of being ignored", () => {
    expect(() => dbConnectionOptionsFromEnv({ DB_PROVIDER: "bun" })).toThrow(
      'DB_PROVIDER="bun" is no longer supported',
    );
  });

  test("postgres or an empty driver selection is accepted", () => {
    expect(dbConnectionOptionsFromEnv({ DB_PROVIDER: "postgres" })).toEqual({});
    expect(dbConnectionOptionsFromEnv({ DB_PROVIDER: "" })).toEqual({});
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

describe("outsideTransactionPoolOptionsFromEnv", () => {
  test("defaults to a small dedicated pool", () => {
    expect(DEFAULT_OUTSIDE_TRANSACTION_POOL_MAX).toBe(3);
    expect(outsideTransactionPoolOptionsFromEnv({})).toEqual({ maxConnections: 3 });
  });

  test("DATABASE_OUTSIDE_TX_POOL_MAX sets the size independently of DATABASE_POOL_MAX", () => {
    expect(
      outsideTransactionPoolOptionsFromEnv({
        DATABASE_POOL_MAX: "25",
        DATABASE_OUTSIDE_TX_POOL_MAX: "5",
      }),
    ).toEqual({ maxConnections: 5 });
  });

  test("invalid value throws", () => {
    expect(() =>
      outsideTransactionPoolOptionsFromEnv({ DATABASE_OUTSIDE_TX_POOL_MAX: "abc" }),
    ).toThrow(/DATABASE_OUTSIDE_TX_POOL_MAX="abc"/);
  });

  test("inherits idle and connect timeouts from the main pool settings", () => {
    expect(
      outsideTransactionPoolOptionsFromEnv({
        DATABASE_POOL_IDLE_TIMEOUT: "60",
        DATABASE_POOL_CONNECT_TIMEOUT: "5",
      }),
    ).toEqual({ maxConnections: 3, idleTimeoutSeconds: 60, connectTimeoutSeconds: 5 });
  });
});
