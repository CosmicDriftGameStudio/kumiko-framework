import { describe, expect, test } from "bun:test";
import { createEntity, createRegistry, createTextField, defineFeature } from "../../engine";
import { createI18n } from "../index";

describe("createI18n", () => {
  const adminFeature = defineFeature("adminUsers", (r) => {
    r.entity("user", createEntity({ table: "Users", fields: { email: createTextField() } }));
    r.translations({
      keys: {
        "nav.title": { de: "Benutzer", en: "Users" },
        "field.email": { de: "E-Mail", en: "Email" },
      },
    });
  });

  const profileFeature = defineFeature("userProfile", (r) => {
    r.translations({
      keys: {
        "nav.title": { de: "Profil", en: "Profile" },
      },
    });
  });

  test("looks up translation by prefixed key and locale", () => {
    const registry = createRegistry([adminFeature]);
    const i18n = createI18n(registry, { defaultLocale: "de" });

    // Keys are prefixed: featureName:key
    expect(i18n.t("adminUsers:nav.title", "de")).toBe("Benutzer");
    expect(i18n.t("adminUsers:nav.title", "en")).toBe("Users");
  });

  test("falls back to default locale", () => {
    const registry = createRegistry([adminFeature]);
    const i18n = createI18n(registry, { defaultLocale: "de" });

    expect(i18n.t("adminUsers:nav.title", "fr")).toBe("Benutzer");
  });

  test("returns key if translation not found", () => {
    const registry = createRegistry([adminFeature]);
    const i18n = createI18n(registry, { defaultLocale: "de" });

    expect(i18n.t("nonexistent.key", "de")).toBe("nonexistent.key");
  });

  test("different features have separate namespaces (no collision)", () => {
    const registry = createRegistry([adminFeature, profileFeature]);
    const i18n = createI18n(registry, { defaultLocale: "de" });

    // Same short key, different prefix — no collision
    expect(i18n.t("adminUsers:nav.title", "de")).toBe("Benutzer");
    expect(i18n.t("userProfile:nav.title", "de")).toBe("Profil");
    expect(i18n.t("adminUsers:field.email", "de")).toBe("E-Mail");
  });

  test("uses default locale when none specified", () => {
    const registry = createRegistry([adminFeature]);
    const i18n = createI18n(registry, { defaultLocale: "de" });

    expect(i18n.t("adminUsers:nav.title")).toBe("Benutzer");
  });

  test("getAllKeys returns prefixed translation keys", () => {
    const registry = createRegistry([adminFeature]);
    const i18n = createI18n(registry, { defaultLocale: "de" });

    const keys = i18n.getAllKeys();
    expect(keys).toContain("adminUsers:nav.title");
    expect(keys).toContain("adminUsers:field.email");
  });
});
