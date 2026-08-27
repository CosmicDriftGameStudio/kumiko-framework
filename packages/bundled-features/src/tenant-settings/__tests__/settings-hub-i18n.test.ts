// fw-i18n-funde: tenant-settings has admin-write keys at tenant-home scope
// (see config.ts) — access.admin includes SystemAdmin, which cascades a
// "set the platform default" screen up to the system audience alongside
// the tenant-home screen (buildConfigFeatureSchema's ELEVATED_ROLES). Both
// used to share the exact same `${feature}.settings` nav label, so the
// sidebar showed the identical raw i18n key twice, once under each
// audience. This test proves the real, declared translations resolve to
// actual text (not the raw key) AND that the two nav entries read
// differently — a regression guard, not an existence check.
//
// de/es copy lives in the lockstep locale packages (fw#2350); the feature
// itself is English-only like the rest of bundled-features after 0.208.0.

import { describe, expect, test } from "bun:test";
import { createConfigFeature } from "@cosmicdrift/kumiko-bundled-features/config";
import { buildConfigFeatureSchema, createRegistry } from "@cosmicdrift/kumiko-framework/engine";
import { localeDeBundle } from "@cosmicdrift/kumiko-locale-de";
import { localeEsBundle } from "@cosmicdrift/kumiko-locale-es";
import { translationsByLocaleFromKeys } from "@cosmicdrift/kumiko-renderer";
import { createTenantSettingsFeature } from "../feature";

function translate(
  translations: Readonly<Record<string, Readonly<Record<string, string>> | undefined>>,
  key: string,
  locale = "en",
): string {
  const byLocale = translationsByLocaleFromKeys(
    translations as Record<string, Readonly<Record<string, string>>>,
  );
  return byLocale[locale]?.[key] ?? key;
}

function settingsHubLabelKeys(): readonly string[] {
  const registry = createRegistry([createConfigFeature(), createTenantSettingsFeature()]);
  const schema = buildConfigFeatureSchema(registry);
  const renderedKeys: string[] = [];
  for (const screenId of ["tenant-settings-system", "tenant-settings-tenant"]) {
    const nav = schema.navs.find((n) => n.id === screenId);
    const screen = schema.screens.find((s) => s.id === screenId);
    if (nav === undefined || screen === undefined || screen.type !== "configEdit") {
      throw new Error(`expected configEdit screen ${screenId}`);
    }
    const section = screen.layout.sections[0];
    const sectionTitle = section !== undefined && "title" in section ? section.title : undefined;
    if (sectionTitle === undefined) throw new Error(`expected section title on ${screenId}`);
    renderedKeys.push(nav.label, `screen:${screenId}.title`, sectionTitle);
    renderedKeys.push(...Object.values(screen.fieldLabels ?? {}));
  }
  return renderedKeys;
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

    expect(systemLabel).not.toBe(systemNav.label);
    expect(tenantLabel).not.toBe(tenantNav.label);
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

  test("every Settings-Hub label resolves in en on the feature and in de/es locale packs", () => {
    const renderedKeys = settingsHubLabelKeys();
    // nav + screen title + section + currency/locale field labels — six distinct keys.
    expect(new Set(renderedKeys).size).toBe(6);

    const translations = createTenantSettingsFeature().translations ?? {};
    for (const key of renderedKeys) {
      const en = translations[key]?.["en"];
      expect(en).toBeString();
      expect(en).not.toBe(key);
    }

    for (const [locale, bundle] of [
      ["de", localeDeBundle],
      ["es", localeEsBundle],
    ] as const) {
      for (const key of renderedKeys) {
        const label = bundle[key];
        expect(label, `${locale}:${key}`).toBeString();
        expect(label).not.toBe(key);
        expect(label).not.toBe(translations[key]?.["en"]);
      }
    }

    expect(localeEsBundle["tenant-settings.settings.system"]).not.toBe(
      localeEsBundle["tenant-settings.settings"],
    );
    expect(localeDeBundle["tenant-settings.settings.system"]).not.toBe(
      localeDeBundle["tenant-settings.settings"],
    );
  });
});
