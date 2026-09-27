import { describe, expect, test } from "bun:test";
import { createEntity, createRegistry, createTextField, defineFeature } from "../../engine";
import { createI18n } from "../index";

describe("createI18n", () => {
  const adminFeature = defineFeature("adminUsers", (r) => {
    r.entity(
      "user",
      createEntity({
        table: "Users",
        fields: { email: createTextField({ personal: false, reason: "test_fixture" }) },
      }),
    );
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

describe("createI18n — plural forms", () => {
  const notificationsFeature = defineFeature("notifications", (r) => {
    r.translations({
      keys: {
        "notifications.unread": {
          de: { one: "{count} ungelesene Nachricht", other: "{count} ungelesene Nachrichten" },
          en: { one: "{count} unread message", other: "{count} unread messages" },
        },
      },
    });
  });

  test("resolves the CLDR category for the given locale and count", () => {
    const registry = createRegistry([notificationsFeature]);
    const i18n = createI18n(registry, { defaultLocale: "en" });

    expect(i18n.t("notifications:notifications.unread", "en", { count: 1 })).toBe(
      "1 unread message",
    );
    expect(i18n.t("notifications:notifications.unread", "en", { count: 5 })).toBe(
      "5 unread messages",
    );
    expect(i18n.t("notifications:notifications.unread", "de", { count: 1 })).toBe(
      "1 ungelesene Nachricht",
    );
  });

  test("falls back to `other` when no params are given", () => {
    const registry = createRegistry([notificationsFeature]);
    const i18n = createI18n(registry, { defaultLocale: "en" });

    expect(i18n.t("notifications:notifications.unread", "en")).toBe("{count} unread messages");
  });
});
