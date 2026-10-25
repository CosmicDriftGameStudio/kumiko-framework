import { describe, expect, test } from "bun:test";
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { createConfigFeature } from "../../config/index.ts";
import { createMailFoundationFeature } from "../../mail-foundation/index.ts";
import { validateProbeTranslations } from "../probe-boot-check.ts";

function featureWithFixScreen(fixScreen: string) {
  return defineFeature("boot-fixture", (r) => {
    r.translations({
      keys: { "boot-fixture.area": { en: "Area" }, "boot-fixture.label": { en: "Label" } },
    });
    r.probe({
      name: "check",
      area: "boot-fixture.area",
      label: "boot-fixture.label",
      scope: "tenant",
      cost: "free",
      fixScreen,
      run: async () => ({ status: "ok", message: { key: "boot-fixture.label" } }),
    });
  });
}

describe("validateProbeTranslations", () => {
  test("rejects a fixScreen that names no mounted screen", () => {
    expect(() =>
      validateProbeTranslations([featureWithFixScreen("nowhere:screen:missing")]),
    ).toThrow(/fixScreen "nowhere:screen:missing"/);
  });

  test("accepts a fixScreen on a generated settings screen", () => {
    expect(() =>
      validateProbeTranslations([
        createConfigFeature(),
        createMailFoundationFeature(),
        featureWithFixScreen("config:screen:mail-foundation-tenant"),
      ]),
    ).not.toThrow();
  });
});
