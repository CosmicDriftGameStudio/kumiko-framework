import { describe, expect, test } from "bun:test";
import type { AgentHandlerHints } from "@cosmicdrift/kumiko-types/handlers";
import * as z from "zod";
import { defineFeature } from "../../define-feature.ts";
import { validateHandlerAccess } from "../entity-handler.ts";

function featureWithWriteAgent(agent: AgentHandlerHints) {
  return defineFeature("proposals", (r) => {
    r.writeHandler({
      name: "adjust-plan",
      schema: z.object({}),
      access: { roles: ["Admin"] },
      description: "Change a suggested plan step.",
      agent,
      handler: async () => ({ isSuccess: true as const, data: {} }),
    });
  });
}

describe("validateHandlerAccess — agent effect proposal", () => {
  test("a low-risk proposal write boots", () => {
    expect(() =>
      validateHandlerAccess(featureWithWriteAgent({ risk: "low", effect: "proposal" })),
    ).not.toThrow();
  });

  test("a proposal write with risk mid is rejected with the handler name", () => {
    const feature = featureWithWriteAgent({ risk: "mid", effect: "proposal" });
    expect(() => validateHandlerAccess(feature)).toThrow(/proposals:write:adjust-plan/);
    expect(() => validateHandlerAccess(feature)).toThrow(/risk: "low"/);
  });

  test("a proposal write with risk high is rejected", () => {
    expect(() =>
      validateHandlerAccess(featureWithWriteAgent({ risk: "high", effect: "proposal" })),
    ).toThrow(/agent.risk "high"/);
  });

  test("a proposal write without a declared risk is rejected, the write default is mid", () => {
    expect(() => validateHandlerAccess(featureWithWriteAgent({ effect: "proposal" }))).toThrow(
      /mid \(default\)/,
    );
  });

  test("a query handler with an effect is rejected", () => {
    const feature = defineFeature("proposals", (r) => {
      r.queryHandler({
        name: "plan",
        schema: z.object({}),
        access: { roles: ["Admin"] },
        agent: { risk: "low", effect: "proposal" },
        handler: async () => ({}),
      });
    });
    expect(() => validateHandlerAccess(feature)).toThrow(/only write handlers have an effect/);
  });
});
