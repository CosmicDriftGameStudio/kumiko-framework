import { describe, expect, spyOn, test } from "bun:test";
import { defineFeature, validateBoot } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { AGENT_TOOLS_FEATURE_NAME, createAgentToolsFeature } from "../feature";

async function noopWriteHandler() {
  return { isSuccess: true as const, data: {} };
}

function undocumentedHandlersFeature() {
  return defineFeature("doc-gap-demo", (r) => {
    r.writeHandler("do-a", z.object({}), noopWriteHandler, { access: { openToAll: true } });
    r.writeHandler("do-b", z.object({}), noopWriteHandler, { access: { openToAll: true } });
    r.writeHandler("do-c", z.object({}), noopWriteHandler, { access: { openToAll: true } });
  });
}

describe("createAgentToolsFeature", () => {
  test("declares name, description, ui hints and exactly one boot check", () => {
    const feature = createAgentToolsFeature();
    expect(feature.name).toBe(AGENT_TOOLS_FEATURE_NAME);
    expect(feature.description?.length ?? 0).toBeGreaterThan(0);
    expect(feature.uiHints?.displayLabel).toBeTruthy();
    expect(feature.bootChecks).toHaveLength(1);
  });

  test("boot check WARNS on undocumented handlers instead of failing the boot", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(() =>
        validateBoot([createAgentToolsFeature(), undocumentedHandlersFeature()]),
      ).not.toThrow();
      expect(warn).toHaveBeenCalled();
      const loggedLines = warn.mock.calls.flat().join("\n");
      expect(loggedLines).toContain("doc-gap-demo:write:do-a");
    } finally {
      warn.mockRestore();
    }
  });

  test("boot check stays silent for a fully-described registry", () => {
    const describedFeature = defineFeature("doc-clean-demo", (r) => {
      r.writeHandler("do-a", z.object({}), noopWriteHandler, {
        access: { openToAll: true },
        description: "Does A.",
      });
    });

    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(() => validateBoot([createAgentToolsFeature(), describedFeature])).not.toThrow();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
