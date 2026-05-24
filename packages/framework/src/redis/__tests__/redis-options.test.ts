import { describe, expect, test } from "bun:test";
import { redisClientOptionsFromEnv } from "../index";

describe("redisClientOptionsFromEnv", () => {
  test("empty env → empty options", () => {
    expect(redisClientOptionsFromEnv({})).toEqual({});
  });

  test("reads all three supported keys", () => {
    const opts = redisClientOptionsFromEnv({
      REDIS_CONNECT_TIMEOUT_MS: "3000",
      REDIS_COMMAND_TIMEOUT_MS: "5000",
      REDIS_MAX_RETRIES_PER_REQUEST: "2",
    });
    expect(opts).toEqual({
      connectTimeoutMs: 3000,
      commandTimeoutMs: 5000,
      maxRetriesPerRequest: 2,
    });
  });

  test("empty string is treated as unset", () => {
    const opts = redisClientOptionsFromEnv({
      REDIS_CONNECT_TIMEOUT_MS: "",
      REDIS_COMMAND_TIMEOUT_MS: "7500",
    });
    expect(opts).toEqual({ commandTimeoutMs: 7500 });
  });

  test("zero is allowed (e.g. 0 retries = fail-fast)", () => {
    const opts = redisClientOptionsFromEnv({
      REDIS_MAX_RETRIES_PER_REQUEST: "0",
    });
    expect(opts).toEqual({ maxRetriesPerRequest: 0 });
  });

  test("negative number → throws", () => {
    expect(() => redisClientOptionsFromEnv({ REDIS_CONNECT_TIMEOUT_MS: "-1" })).toThrow(
      /REDIS_CONNECT_TIMEOUT_MS="-1".*non-negative/i,
    );
  });

  test("non-numeric → throws", () => {
    expect(() => redisClientOptionsFromEnv({ REDIS_COMMAND_TIMEOUT_MS: "ten" })).toThrow(
      /REDIS_COMMAND_TIMEOUT_MS="ten"/,
    );
  });

  test("decimal → throws (ioredis expects integer ms)", () => {
    expect(() => redisClientOptionsFromEnv({ REDIS_CONNECT_TIMEOUT_MS: "250.5" })).toThrow(
      /REDIS_CONNECT_TIMEOUT_MS="250.5".*integer/i,
    );
  });
});
