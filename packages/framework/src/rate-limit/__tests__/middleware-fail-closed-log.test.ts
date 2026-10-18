import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { Hono } from "hono";
import { globalIpRateLimit } from "../middleware.ts";
import type { RateLimitResolver } from "../resolver.ts";

const CLIENT_IP = "203.0.113.9";

describe("default fail-closed logging", () => {
  let errorSpy: ReturnType<typeof spyOn<Console, "error">>;

  beforeEach(() => {
    errorSpy = spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  test("logs only the error message, never the ioredis command args carrying the client IP", async () => {
    const redisError = Object.assign(new Error("connection refused"), {
      command: { name: "evalsha", args: [`l1:${CLIENT_IP}`] },
    });
    const failingCall = async (): Promise<never> => {
      throw redisError;
    };
    const resolver: RateLimitResolver = {
      check: failingCall,
      enforce: failingCall,
      peek: failingCall,
    };
    const app = new Hono();
    app.use("*", globalIpRateLimit({ resolver, extractIp: () => CLIENT_IP }));
    app.get("/", (c) => c.text("ok"));

    const res = await app.request("/");

    expect(res.status).toBe(503);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const logged = errorSpy.mock.calls[0] ?? [];
    expect(logged.some((arg) => JSON.stringify(arg)?.includes(CLIENT_IP))).toBe(false);
    expect(logged).toContain("connection refused");
  });
});
