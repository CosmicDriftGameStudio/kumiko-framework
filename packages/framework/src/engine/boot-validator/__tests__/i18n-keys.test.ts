import { describe, expect, test } from "bun:test";
import { buildConfigFeatureSchema } from "../../build-config-feature-schema";
import { access, createTenantConfig } from "../../config-helpers";
import { defineFeature } from "../../define-feature";
import { createRegistry } from "../../registry";
import { isFieldsEditSection } from "../../screen-helpers";
import type { ConfigEditScreenDefinition } from "../../types";
import { validateBoot } from "../index";

// Mirrors packages/bundled-features/src/config/i18n.ts — the audience-parent
// labels every masked config key's generated hub requires regardless of
// which feature owns the key or which scope its keys are visible at
// (requiredKeysFromGeneratedConfigHub adds all four unconditionally once
// any masked key exists, see i18n-keys.ts:35-38).
const configHub = defineFeature("config", (r) => {
  r.translations({
    keys: {
      "config.settings.title": { en: "Settings" },
      "config.settings.system": { en: "Platform" },
      "config.settings.tenant": { en: "Tenant" },
      "config.settings.user": { en: "Personal" },
    },
  });
});

// fw#2260: the Settings-Hub generator (buildConfigFeatureSchema) labels a
// masked config key's generated nav entry / configEdit section with the
// dot-form key `${feature}.settings` — never colon-form. isI18nKey's
// colon-only check dropped that label from the required-keys set, so a
// feature could ship a generated Settings screen whose label was never
// translated and boot validation stayed silent.
describe("validateI18nSurfaceKeys — Settings-Hub generated dot-form label (fw#2260)", () => {
  function billingFeature(translationKeys: Record<string, { readonly en: string }>) {
    return defineFeature("billing", (r) => {
      r.config({
        keys: {
          // write restricted to a non-elevated role (see ELEVATED_ROLES in
          // build-config-feature-schema.ts) so this stays a single
          // tenant-scope screen — no SystemAdmin cascade to a second one.
          apiKey: createTenantConfig("text", {
            write: access.roles("TenantAdmin"),
            mask: { title: "billing.api-key" },
          }),
        },
      });
      if (Object.keys(translationKeys).length > 0) {
        r.translations({ keys: translationKeys });
      }
    });
  }

  test("generated nav label 'billing.settings' left untranslated fails boot", () => {
    const billing = billingFeature({
      "billing.api-key": { en: "API Key" },
      "screen:billing-tenant.title": { en: "Billing Settings" },
    });
    expect(() => validateBoot([configHub, billing])).toThrow(
      /Settings-Hub: required translation key missing: "billing\.settings"/,
    );
  });

  test("translating the generated dot-form label lets boot pass", () => {
    const billing = billingFeature({
      "billing.api-key": { en: "API Key" },
      "screen:billing-tenant.title": { en: "Billing Settings" },
      "billing.settings": { en: "Billing Settings" },
    });
    expect(() => validateBoot([configHub, billing])).not.toThrow();
  });

  test("group namespace ≠ feature name: blank translation key satisfies hub label", () => {
    const billing = defineFeature("billing", (r) => {
      r.config({
        keys: {
          apiKey: createTenantConfig("text", {
            write: access.roles("TenantAdmin"),
            group: "tenant-settings",
            mask: { title: "billing.api-key" },
          }),
        },
      });
      r.translations({
        keys: {
          "billing.api-key": { en: "API Key" },
          "screen:tenant-settings-tenant.title": { en: "Tenant Settings" },
          "tenant-settings.settings": { en: "Tenant Settings" },
        },
      });
    });
    expect(() => validateBoot([configHub, billing])).not.toThrow();
  });
});

// PR #2314 idx2: buildConfigFeatureSchema varies the generated dot-form label
// along two more paths that fw#2260's tests above never exercise — a tenant
// key with an elevated (SystemAdmin) write role surfaces the same feature
// under a second, broader scope (build-config-feature-schema.ts:142-158), and
// a feature can opt into a configEdit section description
// (build-config-feature-schema.ts:246-249). The `group`-namespace path is
// deliberately left untested here — fw#2314 idx1 tracks it as broken
// (treatDotFormAsKey requires an unsatisfiable `${group}.settings` key for a
// namespace that has no matching feature), and a test would either fail on
// the open bug or paper over it; it belongs with the idx1 fix, not this batch.
describe("validateI18nSurfaceKeys — scoped label fallback for elevated write roles (PR #2314 idx2)", () => {
  function opsFeature(translationKeys: Record<string, { readonly en: string }>) {
    return defineFeature("ops", (r) => {
      r.config({
        keys: {
          // Home scope tenant + an elevated SystemAdmin write role surfaces
          // "ops" under BOTH the tenant audience (home, full write set) and
          // the system audience (cascade, write set ∩ ELEVATED_ROLES.system)
          // — two navs/screens for one feature.
          maintenanceMode: createTenantConfig("boolean", {
            write: access.roles("TenantAdmin", "SystemAdmin"),
            mask: { title: "ops.maintenance-mode" },
          }),
        },
      });
      if (Object.keys(translationKeys).length > 0) {
        r.translations({ keys: translationKeys });
      }
    });
  }

  test("elevated write role surfaces the feature at two scopes; the scoped override labels the system nav while the tenant nav falls back to the plain key", () => {
    const translations = {
      "ops.maintenance-mode": { en: "Maintenance Mode" },
      "screen:ops-tenant.title": { en: "Ops Settings" },
      "screen:ops-system.title": { en: "Ops Settings (Platform)" },
      // Required unconditionally: both screens' section title is always
      // `${feature}.settings` (build-config-feature-schema.ts:248).
      "ops.settings": { en: "Ops" },
      // Opt-in scoped override — only the system (cascade) nav uses it.
      "ops.settings.system": { en: "Ops (Platform Cascade)" },
    };
    const ops = opsFeature(translations);

    const schema = buildConfigFeatureSchema(createRegistry([configHub, ops]));
    expect(schema.navs.find((n) => n.id === "ops-system")?.label).toBe("ops.settings.system");
    expect(schema.navs.find((n) => n.id === "ops-tenant")?.label).toBe("ops.settings");

    expect(() => validateBoot([configHub, ops])).not.toThrow();
  });
});

// isI18nKeys.ts's requiredKeysFromScreen never reads EditFieldsSection.description
// (only title + field labels, see required-surface-keys.ts:210-224), so this
// gate is invisible to validateBoot either way — a validateBoot(...).not.toThrow()
// assertion alone would pass identically with build-config-feature-schema.ts:249
// deleted outright. Assert on the generated schema itself instead, the only
// artifact the gate actually changes.
describe("validateI18nSurfaceKeys — gated configEdit section description (PR #2314 idx2)", () => {
  function reportingFeature(translationKeys: Record<string, { readonly en: string }>) {
    return defineFeature("reporting", (r) => {
      r.config({
        keys: {
          retentionDays: createTenantConfig("number", {
            write: access.roles("TenantAdmin"),
            mask: { title: "reporting.retention-days" },
          }),
        },
      });
      r.translations({ keys: translationKeys });
    });
  }

  function reportingSection(translationKeys: Record<string, { readonly en: string }>) {
    const reporting = reportingFeature(translationKeys);
    const schema = buildConfigFeatureSchema(createRegistry([configHub, reporting]));
    const screen = schema.screens.find(
      (s): s is ConfigEditScreenDefinition => s.type === "configEdit",
    );
    if (screen === undefined) throw new Error("expected a generated configEdit screen");
    const section = screen.layout.sections[0];
    if (section === undefined || !isFieldsEditSection(section)) {
      throw new Error("expected a fields section");
    }
    return section;
  }

  test("declaring 'reporting.settings.description' adds it to the generated section; omitting it leaves the section without one", () => {
    const withDescription = reportingSection({
      "reporting.retention-days": { en: "Retention (days)" },
      "screen:reporting-tenant.title": { en: "Reporting Settings" },
      "reporting.settings": { en: "Reporting" },
      "reporting.settings.description": { en: "Configure how long reports are kept." },
    });
    expect(withDescription.description).toBe("reporting.settings.description");

    const withoutDescription = reportingSection({
      "reporting.retention-days": { en: "Retention (days)" },
      "screen:reporting-tenant.title": { en: "Reporting Settings" },
      "reporting.settings": { en: "Reporting" },
    });
    expect(withoutDescription.description).toBeUndefined();
  });
});
