import { describe, expect, spyOn, test } from "bun:test";
import { defineFeature, validateBoot } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { AGENT_TOOLS_FEATURE_NAME, createAgentToolsFeature } from "../feature.js";

async function noopWriteHandler() {
  return { isSuccess: true as const, data: {} };
}

function undocumentedHandlersFeature() {
  return defineFeature("doc-gap-demo", (r) => {
    r.writeHandler("do-a", z.object({}), noopWriteHandler, {
      access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
    });
    r.writeHandler("do-b", z.object({}), noopWriteHandler, {
      access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
    });
    r.writeHandler("do-c", z.object({}), noopWriteHandler, {
      access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
    });
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
        access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
        description: "Does A.",
      });
      r.translations({ keys: { "doc-clean-demo:write:do-a:title": { en: "Do A" } } });
    });

    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(() => validateBoot([createAgentToolsFeature(), describedFeature])).not.toThrow();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  test("missing handler translations produce one summary line, not one line per handler", () => {
    const untranslated = defineFeature("doc-tr-demo", (r) => {
      for (const name of ["do-a", "do-b"]) {
        r.writeHandler(name, z.object({}), noopWriteHandler, {
          access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
          description: "Does it.",
        });
      }
    });

    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(() => validateBoot([createAgentToolsFeature(), untranslated])).not.toThrow();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls.flat().join("\n")).toContain("2 agent-exposed write handler(s)");
    } finally {
      warn.mockRestore();
    }
  });
});
