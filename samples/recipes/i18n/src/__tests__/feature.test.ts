// i18n Sample — Unit Test (no DB needed)
// Proves: translations registered, locale resolution, fallback to default
// Note: keys are prefixed with feature name → "featureName:key"

import { createRegistry } from "@cosmicdrift/kumiko-framework/engine";
import { createI18n } from "@cosmicdrift/kumiko-framework/i18n";
import { describe, expect, test } from "vitest";
import { errorFeature, greetingFeature } from "../feature";

const registry = createRegistry([greetingFeature, errorFeature]);
const i18n = createI18n(registry, { defaultLocale: "de" });

describe("translation lookup", () => {
  test("returns translation for default locale", () => {
    expect(i18n.t("greeting:greeting.welcome")).toBe("Willkommen");
    expect(i18n.t("greeting:greeting.goodbye")).toBe("Auf Wiedersehen");
  });

  test("returns translation for specific locale", () => {
    expect(i18n.t("greeting:greeting.welcome", "en")).toBe("Welcome");
    expect(i18n.t("greeting:greeting.welcome", "fr")).toBe("Bienvenue");
  });

  test("falls back to default locale for unknown locale", () => {
    expect(i18n.t("greeting:greeting.welcome", "ja")).toBe("Willkommen");
  });

  test("returns key itself for unknown translation key", () => {
    expect(i18n.t("nonexistent.key")).toBe("nonexistent.key");
  });
});

describe("multiple features merge translations", () => {
  test("keys from both features available", () => {
    expect(i18n.t("greeting:greeting.welcome")).toBe("Willkommen");
    expect(i18n.t("errors:errors.not_found")).toBe("Nicht gefunden");
  });

  test("getAllKeys returns all registered keys", () => {
    const keys = i18n.getAllKeys();
    expect(keys).toContain("greeting:greeting.welcome");
    expect(keys).toContain("greeting:greeting.goodbye");
    expect(keys).toContain("greeting:greeting.hello_name");
    expect(keys).toContain("errors:errors.not_found");
    expect(keys).toContain("errors:errors.access_denied");
    expect(keys).toHaveLength(5);
  });
});
