import { describe, expect, test } from "bun:test";
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { bootRuleViolationOf } from "../../shared/__tests__/boot-rule-violation-of.ts";
import { validateProbeTranslations } from "../probe-boot-check.ts";

function probeFeature(options: { readonly area: string; readonly fixScreen?: string }) {
  return defineFeature("readiness-rule-fixture", (r) => {
    r.translations({
      keys: {
        "readiness-rule-fixture.area": { en: "Area" },
        "readiness-rule-fixture.label": { en: "Label" },
      },
    });
    r.probe({
      name: "check",
      area: options.area,
      label: "readiness-rule-fixture.label",
      scope: "tenant",
      cost: "free",
      ...(options.fixScreen !== undefined && { fixScreen: options.fixScreen }),
      run: async () => ({ status: "ok", message: { key: "readiness-rule-fixture.label" } }),
    });
  });
}

describe("readiness boot rules", () => {
  test("an undefined area key violates probe-translation-missing", () => {
    const error = bootRuleViolationOf(() =>
      validateProbeTranslations([probeFeature({ area: "readiness-rule-fixture.ghost" })]),
    );
    expect(error.rule.id).toBe("readiness/probe-translation-missing");
    expect(error.message).toContain('area translation key "readiness-rule-fixture.ghost"');
  });

  test("a fixScreen of no mounted screen violates probe-fix-screen-unknown", () => {
    const error = bootRuleViolationOf(() =>
      validateProbeTranslations([
        probeFeature({ area: "readiness-rule-fixture.area", fixScreen: "nowhere:screen:missing" }),
      ]),
    );
    expect(error.rule.id).toBe("readiness/probe-fix-screen-unknown");
    expect(error.message).toContain('fixScreen "nowhere:screen:missing"');
  });
});
