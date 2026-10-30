import { describe, expect, test } from "bun:test";
import {
  redisChannelPrefixFromEnv,
  redisClientOptionsFromEnv,
  redisNamespaceFromEnv,
} from "../index.ts";

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

describe("redisNamespaceFromEnv", () => {
  test("no variables: unprefixed keys, BullMQ default prefix, no channel prefix", () => {
    expect(redisNamespaceFromEnv({})).toEqual({
      keyPrefix: "",
      bullmqPrefix: "bull",
      channelPrefix: "",
      channelSubscribePattern: undefined,
    });
  });

  test("blank values count as unset", () => {
    expect(
      redisNamespaceFromEnv({ KUMIKO_REDIS_PREFIX: "  ", KUMIKO_REDIS_CHANNEL_PREFIX: "" }),
    ).toEqual(redisNamespaceFromEnv({}));
  });

  test("only the channel prefix keeps the channels-only behaviour", () => {
    expect(redisNamespaceFromEnv({ KUMIKO_REDIS_CHANNEL_PREFIX: "e2e-1" })).toEqual({
      keyPrefix: "",
      bullmqPrefix: "bull",
      channelPrefix: "e2e-1:",
      channelSubscribePattern: undefined,
    });
    expect(redisChannelPrefixFromEnv({ KUMIKO_REDIS_CHANNEL_PREFIX: "e2e-1" })).toBe("e2e-1:");
  });

  test("a prefix namespaces keys, BullMQ and channels and widens the subscribe pattern", () => {
    expect(redisNamespaceFromEnv({ KUMIKO_REDIS_PREFIX: "app-x" })).toEqual({
      keyPrefix: "app-x:",
      bullmqPrefix: "app-x:bull",
      channelPrefix: "app-x:",
      channelSubscribePattern: "app-x:*",
    });
  });

  test("the same value in both variables is accepted", () => {
    const vars = { KUMIKO_REDIS_PREFIX: "app-x", KUMIKO_REDIS_CHANNEL_PREFIX: "app-x" };
    expect(redisNamespaceFromEnv(vars).channelPrefix).toBe("app-x:");
  });

  test("different values in both variables fail the boot", () => {
    expect(() =>
      redisNamespaceFromEnv({ KUMIKO_REDIS_PREFIX: "app-x", KUMIKO_REDIS_CHANNEL_PREFIX: "app-y" }),
    ).toThrow(/differ/);
  });

  test.each(["app:x", "app*", "app x", "-app", "_app", "a".repeat(64), "app?", "app[1]", "äpp"])(
    "invalid prefix %p fails the boot",
    (prefix) => {
      expect(() => redisNamespaceFromEnv({ KUMIKO_REDIS_PREFIX: prefix })).toThrow(
        /KUMIKO_REDIS_PREFIX/,
      );
    },
  );

  test("a 63 character prefix is the longest accepted", () => {
    expect(redisNamespaceFromEnv({ KUMIKO_REDIS_PREFIX: "a".repeat(63) }).keyPrefix).toBe(
      `${"a".repeat(63)}:`,
    );
  });
});
