import { describe, expect, test } from "bun:test";
import { resolveAgentExposure } from "@cosmicdrift/kumiko-types/agent-exposure";
import type { WriteHandlerDefinition } from "@cosmicdrift/kumiko-types/define-handler";
import * as z from "zod";
import { defineFeature } from "../../define-feature.ts";
import { validateHandlerAccess } from "../entity-handler.ts";

type HandlerOverrides = Partial<
  Pick<WriteHandlerDefinition, "access" | "rateLimit" | "agent" | "tenantlessAnonymous">
>;

function featureWith(overrides: HandlerOverrides) {
  return defineFeature("feature", (r) => {
    r.writeHandler({
      name: "name",
      schema: z.object({ topic: z.string() }),
      access: { roles: ["User"] },
      dispatchOnly: true,
      handler: async () => ({ isSuccess: true as const, data: {} }),
      ...overrides,
    });
  });
}

describe("validateHandlerAccess — dispatchOnly", () => {
  test("a dispatchOnly write with role access boots", () => {
    expect(() => validateHandlerAccess(featureWith({}))).not.toThrow();
  });

  test("dispatchOnly with agent.expose: true is rejected", () => {
    expect(() => validateHandlerAccess(featureWith({ agent: { expose: true } }))).toThrow(
      /dispatch-only-agent-exposed|feature:write:name/,
    );
  });

  test("dispatchOnly with tenantlessAnonymous is rejected", () => {
    const feature = featureWith({
      access: { roles: ["anonymous"] },
      rateLimit: { per: "ip", limit: 5, windowSeconds: 60 },
      tenantlessAnonymous: true,
    });
    expect(() => validateHandlerAccess(feature)).toThrow(
      /dispatch-only-tenantless|feature:write:name/,
    );
  });
});

describe("resolveAgentExposure — dispatchOnly", () => {
  test("a dispatchOnly handler is never exposed, even with a description", () => {
    expect(resolveAgentExposure({ description: "x", dispatchOnly: true }, "write").expose).toBe(
      false,
    );
  });

  test("the same handler without dispatchOnly is exposed", () => {
    expect(resolveAgentExposure({ description: "x" }, "write").expose).toBe(true);
  });
});
