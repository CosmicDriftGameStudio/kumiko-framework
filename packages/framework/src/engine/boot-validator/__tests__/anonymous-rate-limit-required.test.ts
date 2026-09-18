import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { defineFeature } from "../../define-feature";
import { validateHandlerAccess } from "../entity-handler";

describe("validateHandlerAccess — anonymous handlers require a rateLimit", () => {
  test("an anonymous handler with no rateLimit throws, naming the handler", () => {
    const feature = defineFeature("rl-anon", (r) => {
      r.writeHandler(
        "note:create",
        z.object({ title: z.string() }),
        async () => ({
          isSuccess: true as const,
          data: {},
        }),
        {
          access: { roles: ["anonymous", "Admin"] },
        },
      );
    });

    expect(() => validateHandlerAccess(feature)).toThrow(/rl-anon:write:note:create/);
    expect(() => validateHandlerAccess(feature)).toThrow(/declares no rateLimit/);
  });

  test("an anonymous handler with rateLimit: { disabled: true, reason } boots fine", () => {
    const feature = defineFeature("rl-anon", (r) => {
      r.writeHandler(
        "note:create",
        z.object({ title: z.string() }),
        async () => ({
          isSuccess: true as const,
          data: {},
        }),
        {
          access: { roles: ["anonymous", "Admin"] },
          rateLimit: { disabled: true, reason: "internal replay path" },
        },
      );
    });

    expect(() => validateHandlerAccess(feature)).not.toThrow();
  });

  test("an anonymous handler with rateLimit: { per: 'ip', ... } boots fine", () => {
    const feature = defineFeature("rl-anon", (r) => {
      r.writeHandler(
        "note:create",
        z.object({ title: z.string() }),
        async () => ({
          isSuccess: true as const,
          data: {},
        }),
        {
          access: { roles: ["anonymous", "Admin"] },
          rateLimit: { per: "ip", limit: 30, windowSeconds: 60 },
        },
      );
    });

    expect(() => validateHandlerAccess(feature)).not.toThrow();
  });
});
