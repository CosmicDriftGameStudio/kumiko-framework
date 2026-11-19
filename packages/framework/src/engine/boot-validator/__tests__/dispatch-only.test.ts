import { describe, expect, test } from "bun:test";
import { resolveAgentExposure } from "@cosmicdrift/kumiko-types/agent-exposure";
import type { WriteHandlerDefinition } from "@cosmicdrift/kumiko-types/define-handler";
import * as z from "zod";
import { defineFeature } from "../../define-feature.ts";
import { validateHandlerAccess } from "../entity-handler.ts";
import { validateQueryRefs } from "../query-refs.ts";

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

  test("a dispatchOnly query with agent.expose: true is rejected", () => {
    const feature = defineFeature("feature", (r) => {
      r.queryHandler({
        name: "lookup",
        schema: z.object({}),
        access: { roles: ["User"] },
        dispatchOnly: true,
        agent: { expose: true },
        handler: async () => ({}),
      });
    });
    expect(() => validateHandlerAccess(feature)).toThrow(/feature:query:lookup/);
  });
});

function featureWithScreenQuery(dispatchOnly: boolean) {
  return defineFeature("feature", (r) => {
    r.queryHandler({
      name: "rows",
      schema: z.object({}),
      access: { roles: ["User"] },
      dispatchOnly,
      handler: async () => ({ rows: [], nextCursor: null }),
    });
    r.screen({
      id: "row-list",
      type: "projectionList",
      query: "feature:query:rows",
      columns: ["title"],
    });
  });
}

describe("validateQueryRefs — dispatchOnly", () => {
  test("a screen loading a dispatchOnly query is rejected", () => {
    expect(() => validateQueryRefs([featureWithScreenQuery(true)])).toThrow(
      /\[Feature feature\] Screen "row-list" \(projectionList\) query "feature:query:rows" is dispatchOnly/,
    );
  });

  test("a screen loading a regular query boots", () => {
    expect(() => validateQueryRefs([featureWithScreenQuery(false)])).not.toThrow();
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
