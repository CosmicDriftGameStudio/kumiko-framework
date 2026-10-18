import { describe, expect, test } from "bun:test";
import * as z from "zod";
import { defineFeature } from "../../define-feature.ts";
import type { WriteHandlerDefinition } from "../../types/index.ts";
import { validateHandlerAccess } from "../entity-handler.ts";

type HandlerOverrides = Partial<Pick<WriteHandlerDefinition, "access" | "rateLimit">>;

function featureWith(overrides: HandlerOverrides) {
  return defineFeature("tenantless", (r) => {
    r.writeHandler({
      name: "intake",
      schema: z.object({ topic: z.string() }),
      access: { roles: ["anonymous"] },
      rateLimit: { per: "ip", limit: 5, windowSeconds: 60 },
      tenantlessAnonymous: true,
      handler: async () => ({ isSuccess: true as const, data: {} }),
      ...overrides,
    });
  });
}

describe("validateHandlerAccess — tenantlessAnonymous", () => {
  test("anonymous-only access with a real rateLimit boots", () => {
    expect(() => validateHandlerAccess(featureWith({}))).not.toThrow();
  });

  test("a handler that is not anonymous-only is rejected", () => {
    const feature = featureWith({ access: { roles: ["anonymous", "Admin"] } });
    expect(() => validateHandlerAccess(feature)).toThrow(/tenantless:write:intake/);
    expect(() => validateHandlerAccess(feature)).toThrow(/not exactly/);
    expect(() => validateHandlerAccess(featureWith({ access: { roles: ["Admin"] } }))).toThrow(
      /not exactly/,
    );
  });

  test("a missing rateLimit is rejected", () => {
    const feature = defineFeature("tenantless", (r) => {
      r.writeHandler({
        name: "intake",
        schema: z.object({ topic: z.string() }),
        access: { roles: ["anonymous"] },
        tenantlessAnonymous: true,
        handler: async () => ({ isSuccess: true as const, data: {} }),
      });
    });
    expect(() => validateHandlerAccess(feature)).toThrow();
  });

  test("a rateLimit scoped to ip+handler boots", () => {
    const feature = featureWith({
      rateLimit: { per: "ip+handler", limit: 5, windowSeconds: 60 },
    });
    expect(() => validateHandlerAccess(feature)).not.toThrow();
  });

  test.each(["tenant", "user", "tenant+handler", "user+handler"] as const)(
    "a rateLimit scoped per %s is rejected",
    (per) => {
      const feature = featureWith({ rateLimit: { per, limit: 5, windowSeconds: 60 } });
      expect(() => validateHandlerAccess(feature)).toThrow(/"ip" or "ip\+handler"/);
    },
  );

  test("a disabled rateLimit does not count", () => {
    const feature = featureWith({ rateLimit: { disabled: true, reason: "no limit please" } });
    expect(() => validateHandlerAccess(feature)).toThrow(/without a rateLimit/);
  });
});
