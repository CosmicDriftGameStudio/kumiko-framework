import { describe, expect, test } from "bun:test";
import { redisNamespaceFromEnv } from "@cosmicdrift/kumiko-framework/redis";
import { resolveDevDbMode } from "../create-kumiko-server-stack.ts";

describe("resolveDevDbMode sseChannelPrefix", () => {
  test("is per boot without any redis setting", () => {
    expect(resolveDevDbMode({}).sseChannelPrefix).toStartWith("kumiko-dev-");
  });

  test("an explicit channel prefix wins", () => {
    expect(resolveDevDbMode({ KUMIKO_REDIS_CHANNEL_PREFIX: "worker-a" }).sseChannelPrefix).toBe(
      "worker-a",
    );
  });

  test("follows KUMIKO_REDIS_PREFIX so the namespace check accepts the dev boot", () => {
    const processEnv = { KUMIKO_REDIS_PREFIX: "myapp" };
    const { sseChannelPrefix } = resolveDevDbMode(processEnv);
    expect(sseChannelPrefix).toBe("myapp");
    expect(() =>
      redisNamespaceFromEnv({ ...processEnv, KUMIKO_REDIS_CHANNEL_PREFIX: sseChannelPrefix }),
    ).not.toThrow();
  });
});
