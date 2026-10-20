import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { inMemoryLoginRateLimiterFallback } from "../auth-routes.ts";

describe("inMemoryLoginRateLimiterFallback", () => {
  let warnSpy: ReturnType<typeof spyOn<Console, "warn">>;
  const originalNodeEnv = process.env["NODE_ENV"];

  beforeEach(() => {
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    process.env["NODE_ENV"] = originalNodeEnv;
  });

  test("outside production it stays silent", () => {
    process.env["NODE_ENV"] = "test";

    inMemoryLoginRateLimiterFallback();

    expect(warnSpy).not.toHaveBeenCalled();
  });

  test("in production it warns once per process however many limiters fall back", () => {
    process.env["NODE_ENV"] = "production";

    for (let site = 0; site < 4; site++) inMemoryLoginRateLimiterFallback();

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warnSpy.mock.calls[0])).toContain("in-memory; limits are per replica");
  });
});
