import { describe, expect, test } from "bun:test";
import { resolveRateLimit } from "../rate-limit-defaults.js";

describe("resolveRateLimit", () => {
  test("defaults to L1 600/60 s and L2 30/60 s", () => {
    expect(resolveRateLimit(undefined)).toEqual({
      global: { limit: 600, windowSeconds: 60 },
      auth: { limit: 30, windowSeconds: 60 },
    });
  });

  test("false switches everything off", () => {
    expect(resolveRateLimit(false)).toBeUndefined();
  });

  test("a partial layer overrides only its own fields, the other layer keeps its default", () => {
    expect(resolveRateLimit({ global: { limit: 100 } })).toEqual({
      global: { limit: 100, windowSeconds: 60 },
      auth: { limit: 30, windowSeconds: 60 },
    });
    expect(resolveRateLimit({ auth: { windowSeconds: 10, path: "/api/login/*" } })).toEqual({
      global: { limit: 600, windowSeconds: 60 },
      auth: { limit: 30, windowSeconds: 10, path: "/api/login/*" },
    });
  });

  test("false per layer switches that layer off", () => {
    expect(resolveRateLimit({ global: false })).toEqual({
      auth: { limit: 30, windowSeconds: 60 },
    });
    expect(resolveRateLimit({ auth: false })).toEqual({
      global: { limit: 600, windowSeconds: 60 },
    });
  });
});
