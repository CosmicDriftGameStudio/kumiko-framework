import { describe, expect, test } from "bun:test";
import type { RateLimitDeclaration } from "@cosmicdrift/kumiko-types/handlers";
import * as z from "zod";
import { defineFeature } from "../../define-feature.ts";
import { validateHandlerAccess } from "../entity-handler.ts";

describe("validateHandlerAccess — rateLimit: { disabled: true } reason", () => {
  test("an empty reason throws, naming the handler", () => {
    const feature = defineFeature("rl-guard", (r) => {
      r.writeHandler({
        name: "note:create",
        schema: z.object({ title: z.string() }),
        handler: async () => ({
          isSuccess: true as const,
          data: {},
        }),
        access: { roles: ["Admin"] },
        rateLimit: { disabled: true, reason: "" },
      });
    });

    expect(() => validateHandlerAccess(feature)).toThrow(/rl-guard:write:note:create/);
    expect(() => validateHandlerAccess(feature)).toThrow(/rateLimit: \{ disabled: true \}/);
  });

  test("a non-empty reason boots fine", () => {
    const feature = defineFeature("rl-guard", (r) => {
      r.writeHandler({
        name: "note:create",
        schema: z.object({ title: z.string() }),
        handler: async () => ({
          isSuccess: true as const,
          data: {},
        }),
        access: { roles: ["Admin"] },
        rateLimit: { disabled: true, reason: "ops replay path" },
      });
    });

    expect(() => validateHandlerAccess(feature)).not.toThrow();
  });
});

describe("validateHandlerAccess — rateLimitCost", () => {
  const featureWith = (rateLimit: RateLimitDeclaration | undefined) =>
    defineFeature("rl-cost-guard", (r) => {
      r.writeHandler({
        name: "bulk",
        schema: z.object({ items: z.array(z.string()) }),
        handler: async () => ({ isSuccess: true as const, data: {} }),
        access: { roles: ["Admin"] },
        rateLimit,
        rateLimitCost: (payload) => payload.items.length,
      });
    });

  test("without a rateLimit it throws, naming the handler", () => {
    expect(() => validateHandlerAccess(featureWith(undefined))).toThrow(
      /rl-cost-guard:write:bulk.*rateLimitCost/,
    );
  });

  test("with rateLimit disabled it throws", () => {
    const feature = featureWith({ disabled: true, reason: "ops replay path" });
    expect(() => validateHandlerAccess(feature)).toThrow(/rateLimitCost/);
  });

  const featureWithAccess = (roles: string[], rateLimit: RateLimitDeclaration) =>
    defineFeature("rl-cost-guard", (r) => {
      r.writeHandler({
        name: "bulk",
        schema: z.object({ items: z.array(z.string()) }),
        handler: async () => ({ isSuccess: true as const, data: {} }),
        access: { roles },
        rateLimit,
        rateLimitCost: (payload) => payload.items.length,
      });
    });

  test("an ip-scoped bucket throws", () => {
    const feature = featureWithAccess(["Admin"], { per: "ip", limit: 5, windowSeconds: 60 });
    expect(() => validateHandlerAccess(feature)).toThrow(/rateLimitCost.*anonymous or ip-limited/);
  });

  test("an anonymous handler throws", () => {
    const feature = featureWithAccess(["anonymous"], {
      per: "tenant",
      limit: 5,
      windowSeconds: 60,
    });
    expect(() => validateHandlerAccess(feature)).toThrow(/rateLimitCost.*anonymous or ip-limited/);
  });

  test("with an active rateLimit it boots", () => {
    const feature = featureWith({ per: "tenant", limit: 5, windowSeconds: 60 });
    expect(() => validateHandlerAccess(feature)).not.toThrow();
  });
});
