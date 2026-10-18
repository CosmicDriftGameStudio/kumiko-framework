import { describe, expect, test } from "bun:test";
import { createRegistry } from "@cosmicdrift/kumiko-framework/engine";
import { createTemplateResolverFeature } from "../feature.ts";
import {
  DEFAULT_RESOURCE_MAX_BYTES,
  RESOURCE_MAX_BYTES_CONFIG_KEY,
} from "../handlers/resource-shared.ts";

// feature.ts spells the default as a literal (the few-shot corpus parser reads only literals).
describe("template-resolver :: resource-max-bytes", () => {
  test("the registered config default equals the handler fallback", () => {
    const registry = createRegistry([createTemplateResolverFeature()]);
    expect(registry.getConfigKey(RESOURCE_MAX_BYTES_CONFIG_KEY)?.default).toBe(
      DEFAULT_RESOURCE_MAX_BYTES,
    );
  });
});
