import { describe, expect, test } from "bun:test";
import { SETTINGS_HUB_I18N } from "@cosmicdrift/kumiko-framework/i18n";
import { defaultTranslations } from "../i18n.js";

describe("config web default translations", () => {
  test("every Settings-Hub key shipped by the web bundle has the server's en text", () => {
    const webEn = defaultTranslations["en"] ?? {};
    const sharedKeys = Object.keys(SETTINGS_HUB_I18N).filter((key) => key in webEn);

    expect(sharedKeys.length).toBeGreaterThan(0);
    for (const key of sharedKeys) {
      expect(webEn[key]).toBe(SETTINGS_HUB_I18N[key]?.["en"]);
    }
  });
});
