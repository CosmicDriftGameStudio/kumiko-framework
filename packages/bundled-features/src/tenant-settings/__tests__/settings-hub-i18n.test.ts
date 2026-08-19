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
import { createTenantSettingsFeature } from "../feature";

function translate(
  translations: Readonly<Record<string, Readonly<Record<string, string>> | undefined>>,
  key: string,
  locale = "en",
): string {
  return translations[key]?.[locale] ?? key;
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
});
