import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { consoleCallsMentioning } from "@cosmicdrift/kumiko-testing/helpers";
import { defineFeature } from "../../define-feature.ts";
import { validateBoot } from "../index.ts";

describe("validateBoot returns its warnings", () => {
  let warnSpy: ReturnType<typeof spyOn<Console, "warn">>;

  beforeEach(() => {
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  test("a toggleable(default=false) dependency is returned and still logged", () => {
    const optIn = defineFeature("b", (r) => {
      r.toggleable({ default: false });
    });
    const dependent = defineFeature("a", (r) => {
      r.requires({ features: ["b"] });
    });

    const { warnings } = validateBoot([dependent, optIn]);

    expect(warnings).toEqual([
      expect.objectContaining({ kind: "config/toggleable-dependency", feature: "a" }),
    ]);
    expect(warnings[0]?.message).toContain('requires "b"');
    expect(consoleCallsMentioning(warnSpy, warnings[0]?.message ?? "")).toHaveLength(1);
  });

  test("user-data-rights without a persistent file provider is an ephemeral-store warning", () => {
    const { warnings } = validateBoot([defineFeature("user-data-rights", () => {})]);

    expect(warnings).toContainEqual(expect.objectContaining({ kind: "gdpr/ephemeral-store" }));
  });

  test("a clean composition returns no warnings", () => {
    expect(validateBoot([defineFeature("solo", () => {})]).warnings).toEqual([]);
  });
});
