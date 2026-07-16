import { describe, expect, test } from "bun:test";
import { createSystemConfig } from "../../config-helpers";
import type { FeatureDefinition } from "../../types";
import { validateConfigKeyAllowPerRequest, validateConfigKeyComputed } from "../config-deps";

function fakeFeature(configKeys: FeatureDefinition["configKeys"]): FeatureDefinition {
  return { name: "test-feature", configKeys } as unknown as FeatureDefinition;
}

describe("validateConfigKeyComputed", () => {
  test("rejects computed + backing:secrets (encrypted-at-rest via backing, not the encrypted flag)", () => {
    const feature = fakeFeature({
      apiKey: createSystemConfig("text", { backing: "secrets", computed: async () => "x" }),
    });
    expect(() => validateConfigKeyComputed(feature)).toThrow(/mutually exclusive/);
  });

  test("rejects computed + encrypted:true", () => {
    const feature = fakeFeature({
      apiKey: createSystemConfig("text", { encrypted: true, computed: async () => "x" }),
    });
    expect(() => validateConfigKeyComputed(feature)).toThrow(/mutually exclusive/);
  });

  test("allows computed without encryption", () => {
    const feature = fakeFeature({
      apiKey: createSystemConfig("text", { computed: async () => "x" }),
    });
    expect(() => validateConfigKeyComputed(feature)).not.toThrow();
  });
});

describe("validateConfigKeyAllowPerRequest", () => {
  test("rejects allowPerRequest + backing:secrets on a number key", () => {
    const feature = fakeFeature({
      rateLimit: createSystemConfig("number", { backing: "secrets", allowPerRequest: true }),
    });
    expect(() => validateConfigKeyAllowPerRequest(feature)).toThrow(
      /may not be set via query-params/,
    );
  });
});
