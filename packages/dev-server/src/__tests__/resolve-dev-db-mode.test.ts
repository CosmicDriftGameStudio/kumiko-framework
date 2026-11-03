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

  test("trims the explicit channel prefix and ignores a blank one", () => {
    expect(resolveDevDbMode({ KUMIKO_REDIS_CHANNEL_PREFIX: "  worker-a " }).sseChannelPrefix).toBe(
      "worker-a",
    );
    expect(resolveDevDbMode({ KUMIKO_REDIS_CHANNEL_PREFIX: "   " }).sseChannelPrefix).toStartWith(
      "kumiko-dev-",
    );
  });

  test("the explicit channel prefix wins over KUMIKO_REDIS_PREFIX", () => {
    expect(
      resolveDevDbMode({ KUMIKO_REDIS_CHANNEL_PREFIX: "worker-a", KUMIKO_REDIS_PREFIX: "myapp" })
        .sseChannelPrefix,
    ).toBe("worker-a");
  });

  test("persistent mode falls back to the stable job queue prefix", () => {
    const mode = resolveDevDbMode({ KUMIKO_DEV_DB_NAME: "devdb" });
    expect(mode.persistentDb).toBe(true);
    expect(mode.sseChannelPrefix).toBe("kumiko-dev-devdb");
    expect(mode.sseChannelPrefix).toBe(mode.jobQueueNamePrefix);
  });

  test("ephemeral mode uses the per-boot job queue prefix", () => {
    const mode = resolveDevDbMode({});
    expect(mode.persistentDb).toBe(false);
    expect(mode.sseChannelPrefix).toBe(mode.jobQueueNamePrefix);
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
