// fw-i18n-funde: tenant-settings has admin-write keys at tenant-home scope
// (see config.ts) — access.admin includes SystemAdmin, which cascades a
// "set the platform default" screen up to the system audience alongside
// the tenant-home screen (buildConfigFeatureSchema's ELEVATED_ROLES). Both
// used to share the exact same `${feature}.settings` nav label, so the
// sidebar showed the identical raw i18n key twice, once under each
// audience. This test proves the real, declared translations resolve to
// actual text (not the raw key) AND that the two nav entries read
// differently — a regression guard, not an existence check.

import { describe, expect, test } from "bun:test";
import { createConfigFeature } from "@cosmicdrift/kumiko-bundled-features/config";
import { buildConfigFeatureSchema, createRegistry } from "@cosmicdrift/kumiko-framework/engine";
import { translationsByLocaleFromKeys } from "@cosmicdrift/kumiko-renderer";
import { createTenantSettingsFeature } from "../feature";

function translate(
  translations: Readonly<Record<string, Readonly<Record<string, string>> | undefined>>,
  key: string,
  locale = "en",
): string {
  const byLocale = translationsByLocaleFromKeys(translations as Record<string, Readonly<Record<string, string>>>);
  return byLocale[locale]?.[key] ?? key;
}

describe("tenant-settings — Settings-Hub nav/section labels", () => {
  test("system + tenant scope screens both translate, and their nav labels differ", () => {
    const registry = createRegistry([createConfigFeature(), createTenantSettingsFeature()]);
    const schema = buildConfigFeatureSchema(registry);
    const translations = registry.getFeature("tenant-settings")?.translations ?? {};

    const systemNav = schema.navs.find((n) => n.id === "tenant-settings-system");
    const tenantNav = schema.navs.find((n) => n.id === "tenant-settings-tenant");
    expect(systemNav).toBeDefined();
    expect(tenantNav).toBeDefined();
    if (systemNav === undefined || tenantNav === undefined) throw new Error("unreachable");

    const systemLabel = translate(translations, systemNav.label);
    const tenantLabel = translate(translations, tenantNav.label);

    // Both labels actually resolve to text — not an echoed raw key.
    expect(systemLabel).not.toBe(systemNav.label);
    expect(tenantLabel).not.toBe(tenantNav.label);
    // The cross-scope duplicate this test guards against: the two nav
    // entries read differently instead of repeating the same words under
    // both "Platform" and "Organization".
    expect(systemLabel).not.toBe(tenantLabel);

    const systemScreen = schema.screens.find((s) => s.id === "tenant-settings-system");
    expect(systemScreen).toBeDefined();
    if (systemScreen === undefined || systemScreen.type !== "configEdit") {
      throw new Error("unreachable");
    }
    const section = systemScreen.layout.sections[0];
    const sectionTitle = section !== undefined && "title" in section ? section.title : undefined;
    expect(sectionTitle).toBeDefined();
    if (sectionTitle === undefined) throw new Error("unreachable");
    expect(translate(translations, sectionTitle)).not.toBe(sectionTitle);
  });

  test("every Settings-Hub label the schema renders resolves in es, distinct from en", () => {
    const registry = createRegistry([createConfigFeature(), createTenantSettingsFeature()]);
    const schema = buildConfigFeatureSchema(registry);
    const translations = registry.getFeature("tenant-settings")?.translations ?? {};

    const renderedKeys: string[] = [];
    for (const screenId of ["tenant-settings-system", "tenant-settings-tenant"]) {
      const nav = schema.navs.find((n) => n.id === screenId);
      const screen = schema.screens.find((s) => s.id === screenId);
      expect(nav).toBeDefined();
      expect(screen).toBeDefined();
      if (nav === undefined || screen === undefined || screen.type !== "configEdit") {
        throw new Error("unreachable");
      }
      const section = screen.layout.sections[0];
      const sectionTitle = section !== undefined && "title" in section ? section.title : undefined;
      expect(sectionTitle).toBeDefined();
      if (sectionTitle === undefined) throw new Error("unreachable");

      renderedKeys.push(nav.label, `screen:${screenId}.title`, sectionTitle);
      renderedKeys.push(...Object.values(screen.fieldLabels ?? {}));
    }

    // The Settings-Hub renders exactly these label surfaces per scope: nav
    // entry, screen title, section heading and one label per masked config
    // key (currency + locale) — six distinct keys across both scopes.
    expect(new Set(renderedKeys).size).toBe(6);

    for (const key of renderedKeys) {
      expect(translate(translations, key, "es")).not.toBe(key);
      expect(translate(translations, key, "es")).not.toBe(translate(translations, key, "en"));
    }

    const systemLabel = translate(translations, "tenant-settings.settings.system", "es");
    const tenantLabel = translate(translations, "tenant-settings.settings", "es");
    expect(systemLabel).not.toBe(tenantLabel);
  });
});
