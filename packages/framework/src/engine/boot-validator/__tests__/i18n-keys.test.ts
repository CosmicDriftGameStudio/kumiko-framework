import { describe, expect, test } from "bun:test";
import type { ConfigEditScreenDefinition } from "@cosmicdrift/kumiko-types/screen";
import * as z from "zod";
import {
  findRequiredLocaleGaps,
  findTranslationLocaleGaps,
} from "../../../i18n/required-surface-keys.ts";
import { SETTINGS_HUB_I18N } from "../../../i18n/settings-hub-keys.ts";
import { buildConfigFeatureSchema } from "../../build-config-feature-schema.ts";
import { access, createTenantConfig } from "../../config-helpers.ts";
import { defineFeature } from "../../define-feature.ts";
import { createEntity, createTextField } from "../../factories.ts";
import { i18nKey } from "../../i18n-key.ts";
import { createRegistry } from "../../registry.ts";
import { isFieldsEditSection } from "../../screen-helpers.ts";

import { BootValidationError } from "../boot-rule.ts";
import { validateBoot } from "../index.ts";

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
      "config.settings.audience.system": { en: "Applies to every tenant." },
      "config.settings.audience.tenant": { en: "Applies to this tenant." },
      "config.settings.audience.user": { en: "Only applies to you." },
    },
  });
});

// The Settings-Hub generator (buildConfigFeatureSchema) labels a
// masked config key's generated nav entry / configEdit section with the
// dot-form key `${feature}.settings` — never colon-form. isI18nKey's
// colon-only check dropped that label from the required-keys set, so a
// feature could ship a generated Settings screen whose label was never
// translated and boot validation stayed silent.
describe("validateI18nSurfaceKeys — generated dot-form label for the Settings Hub", () => {
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

  test("a missing feature key does not hide a missing settings-hub key", () => {
    const billing = defineFeature("billing", (r) => {
      r.entity({
        name: "invoice",
        ...createEntity({
          table: "Invoices",
          fields: { title: createTextField({ personal: false, reason: "test_fixture" }) },
        }),
      });
      r.screen({
        id: "invoice-list",
        type: "entityList",
        entity: "invoice",
        columns: ["title"],
        defaultSort: { field: "title", dir: "asc" },
      });
      r.config({
        keys: {
          apiKey: createTenantConfig("text", {
            write: access.roles("TenantAdmin"),
            mask: { title: "billing.api-key" },
          }),
        },
      });
      r.translations({ keys: { "billing.api-key": { en: "API Key" } } });
    });
    let ruleIds: readonly string[] = [];
    try {
      validateBoot([configHub, billing]);
    } catch (e) {
      if (!(e instanceof BootValidationError)) throw e;
      ruleIds = e.violations.map((v) => v.ruleId);
    }
    expect(ruleIds).toContain("i18n/missing-feature-key");
    expect(ruleIds).toContain("i18n/missing-settings-hub-key");
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

// buildConfigFeatureSchema varies the generated dot-form label along two
// more paths that the tests above never exercise — a tenant key with an
// elevated (SystemAdmin) write role surfaces the same feature under a second,
// broader scope (build-config-feature-schema.ts:142-158), and a feature can
// opt into a configEdit section description
// (build-config-feature-schema.ts:246-249). The `group`-namespace path is
// deliberately left untested here because treatDotFormAsKey requires an
// unsatisfiable `${group}.settings` key for a namespace that has no matching
// feature, and a test would either fail on the open bug or paper over it; it
// belongs with the namespace fix, not this batch.
describe("validateI18nSurfaceKeys — scoped label fallback for elevated write roles", () => {
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
describe("validateI18nSurfaceKeys — gated configEdit section description", () => {
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

  test("declaring 'reporting.settings.description' adds it to the generated section; omitting it falls back to the audience sentence", () => {
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
    expect(withoutDescription.description).toBe("config.settings.audience.tenant");
  });
});

// A hand-written dot-form label is indistinguishable from literal display
// text, so isI18nKey only requires a translation for one explicitly marked via
// i18nKey() — unmarked dot-form labels must keep failing silently (that's the
// existing, intentional behavior for literal text like "actions.open"), never
// crashing boot on their own.
describe("validateI18nSurfaceKeys — explicit i18nKey() dot-form opt-in", () => {
  test("i18nKey()-marked dot-form label without a translation fails boot naming the key", () => {
    const feature = defineFeature("fw2313boot", (r) => {
      r.nav({ id: "home", label: i18nKey("fw2313.boot.optin.nav") });
    });
    expect(() => validateBoot([feature])).toThrow(
      /required translation key missing: "fw2313\.boot\.optin\.nav"/,
    );
  });

  test("i18nKey()-marked dot-form label with a translation passes boot", () => {
    const feature = defineFeature("fw2313boot", (r) => {
      r.nav({ id: "home", label: i18nKey("fw2313.boot.optin.nav.translated") });
      r.translations({ keys: { "fw2313.boot.optin.nav.translated": { en: "Home" } } });
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test("unmarked literal dot-form label never fails boot", () => {
    const feature = defineFeature("fw2313boot", (r) => {
      r.nav({ id: "home", label: "fw2313.boot.never-marked.literal" });
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });
});

// The mask.title bypass is unconditional (required-surface-keys.ts,
// requiredKeysFromFeature) — mask.title is always an i18n key by
// ConfigKeyDefinition contract, never literal display text, so it needs no
// i18nKey() marker.
describe("validateI18nSurfaceKeys — mask.title is unconditionally required", () => {
  function maskedFeature(translationKeys: Record<string, { readonly en: string }>) {
    return defineFeature("fw2313mask", (r) => {
      r.config({
        keys: {
          apiKey: createTenantConfig("text", {
            write: access.roles("TenantAdmin"),
            mask: { title: "fw2313.boot.mask.title" },
          }),
        },
      });
      if (Object.keys(translationKeys).length > 0) {
        r.translations({ keys: translationKeys });
      }
    });
  }

  test("masked config key without a mask.title translation fails boot", () => {
    const feature = maskedFeature({});
    expect(() => validateBoot([configHub, feature])).toThrow(
      /required translation key missing: "fw2313\.boot\.mask\.title"/,
    );
  });

  test("masked config key with a mask.title translation passes boot", () => {
    const feature = maskedFeature({
      "fw2313.boot.mask.title": { en: "API Key" },
      "screen:fw2313mask-tenant.title": { en: "Settings" },
      "fw2313mask.settings": { en: "Settings" },
    });
    expect(() => validateBoot([configHub, feature])).not.toThrow();
  });
});

describe("validateI18nSurfaceKeys — extension-selector settings dashboard", () => {
  const secretsMount = defineFeature("secrets", (r) => {
    r.writeHandler({
      name: "set",
      schema: z.object({ key: z.string(), value: z.string() }),
      handler: async () => ({ isSuccess: true, data: null }),
      access: { roles: ["TenantAdmin"] },
    });
  });
  const hubWithHint = defineFeature("config", (r) => {
    r.translations({ keys: SETTINGS_HUB_I18N });
  });
  const hubWithoutHint = defineFeature("config", (r) => {
    const { "config.settings.extensionSelectorHint": _hint, ...withoutHint } = SETTINGS_HUB_I18N;
    r.translations({ keys: withoutHint });
  });

  // Consumer-shaped: only the keys an app declared before the selector screen existed.
  const owner = defineFeature("mail-foundation", (r) => {
    r.translations({
      keys: {
        "mail-foundation.settings": { en: "Mail" },
        "screen:mail-foundation-tenant.title": { en: "Mail" },
        "mail.provider": { en: "Provider" },
      },
    });
    r.extendsRegistrar("mailTransport", { onRegister: () => undefined });
    const keys = r.config({
      keys: {
        provider: createTenantConfig("text", {
          default: "",
          write: access.roles("TenantAdmin"),
          mask: { title: "mail.provider" },
        }),
      },
    });
    r.extensionSelector("mailTransport", keys.provider);
  });
  const smtp = defineFeature("mail-smtp", (r) => {
    r.requires({ features: ["mail-foundation"] });
    r.translations({
      keys: {
        "mail-smtp.settings": { en: "SMTP" },
        "screen:mail-smtp-tenant.title": { en: "SMTP" },
        "smtp.host": { en: "Host" },
      },
    });
    r.useExtension("mailTransport", "smtp");
    r.config({
      keys: {
        host: createTenantConfig("text", {
          default: "",
          write: access.roles("TenantAdmin"),
          mask: { title: "smtp.host" },
        }),
      },
    });
    r.secret("password", { label: { en: "SMTP password" }, scope: "tenant" });
  });

  test("an app declaring only today's keys boots with the selector dashboard", () => {
    expect(() => validateBoot([hubWithHint, secretsMount, owner, smtp])).not.toThrow();
  });

  test("the dashboard hint key is required once a selector dashboard exists", () => {
    expect(() => validateBoot([hubWithoutHint, secretsMount, owner, smtp])).toThrow(
      /Settings-Hub: required translation key missing: "config\.settings\.extensionSelectorHint"/,
    );
  });
});

describe("translation locale consistency per feature", () => {
  function featureWith(name: string, keys: Record<string, Record<string, unknown>>) {
    return defineFeature(name, (r) => {
      // Deliberately loose: the empty-string case is not expressible as a stricter type.
      r.translations({ keys: keys as Parameters<typeof r.translations>[0]["keys"] });
    });
  }

  test("a key missing a locale that a sibling key carries fails boot and names feature, key and locale", () => {
    const mixed = featureWith("mixed", {
      a: { en: "A", de: "A" },
      b: { en: "B" },
    });

    expect(() => validateBoot([mixed])).toThrow(
      /\[i18n\] Feature "mixed": translation key "b" is missing locale\(s\) de\./,
    );
  });

  test("lists every gap in one error with sorted locales", () => {
    const mixed = featureWith("mixed", {
      a: { en: "A", de: "A", fr: "A" },
      b: { en: "B" },
      c: { de: "C", fr: "C" },
    });

    expect(findTranslationLocaleGaps([mixed])).toEqual([
      { featureName: "mixed", key: "b", missingLocales: ["de", "fr"] },
      { featureName: "mixed", key: "c", missingLocales: ["en"] },
    ]);
    expect(() => validateBoot([mixed])).toThrow(/key "b"[\s\S]*key "c"/);
  });

  test("complete, single-locale and plural entries do not fail", () => {
    const complete = featureWith("complete", {
      a: { en: "A", de: "A" },
      b: { en: { one: "one", other: "many" }, de: { one: "eins", other: "viele" } },
    });
    const englishOnly = featureWith("english-only", { a: { en: "A" }, b: { en: "B" } });

    expect(findTranslationLocaleGaps([complete, englishOnly])).toEqual([]);
    expect(() => validateBoot([complete, englishOnly])).not.toThrow();
  });

  test("a locale package's flat plural keys cover the feature's plural key", () => {
    const shop = featureWith("shop", { items: { en: { one: "1 item", other: "{count} items" } } });
    const localeEs = featureWith("locale-es", {
      "shop:items.one": { es: "1 artículo" },
      "shop:items.other": { es: "{count} artículos" },
    });
    expect(findRequiredLocaleGaps([shop, localeEs], ["en", "es"])).toEqual([]);
  });

  test("two regular features sharing a plain key do not cover each other", () => {
    const shop = featureWith("shop", { title: { en: "T" } });
    const blog = featureWith("blog", { title: { en: "T", de: "T" } });
    expect(findRequiredLocaleGaps([shop, blog], ["en", "de"])).toEqual([
      { featureName: "shop", key: "title", missingLocales: ["de"] },
    ]);
  });

  test("an empty string counts as missing", () => {
    const blank = featureWith("blank", { a: { en: "A", de: "A" }, b: { en: "B", de: "" } });

    expect(findTranslationLocaleGaps([blank])).toEqual([
      { featureName: "blank", key: "b", missingLocales: ["de"] },
    ]);
  });
});

describe("requiredLocales", () => {
  function featureWith(name: string, keys: Record<string, Record<string, unknown>>) {
    return defineFeature(name, (r) => {
      // Deliberately loose: the empty-string case is not expressible as a stricter type.
      r.translations({ keys: keys as Parameters<typeof r.translations>[0]["keys"] });
    });
  }

  test("a key without a required locale is a gap attributed to the defining feature", () => {
    const shop = featureWith("shop", { title: { en: "T", de: "T" } });
    expect(findRequiredLocaleGaps([shop], ["en", "de", "es"])).toEqual([
      { featureName: "shop", key: "title", missingLocales: ["es"] },
    ]);
  });

  test("a locale package translating the full feature:key closes the gap", () => {
    const shop = featureWith("shop", { title: { en: "T" }, "other:x": { en: "X" } });
    const localeDe = featureWith("locale-de", { "shop:title": { de: "T" } });
    expect(findRequiredLocaleGaps([shop, localeDe], ["en", "de"])).toEqual([
      { featureName: "shop", key: "other:x", missingLocales: ["de"] },
    ]);
    expect(findRequiredLocaleGaps([shop, localeDe], ["en"])).toEqual([]);
  });

  test("an empty string counts as missing", () => {
    const blank = featureWith("blank", { a: { en: "A", de: "" } });
    expect(findRequiredLocaleGaps([blank], ["en", "de"])).toEqual([
      { featureName: "blank", key: "a", missingLocales: ["de"] },
    ]);
  });

  test("validateBoot throws with requiredLocales and passes without", () => {
    const shop = featureWith("shop", { title: { en: "T" } });
    expect(() => validateBoot([shop], { requiredLocales: ["en", "de"] })).toThrow(
      /key "title" is missing required locale\(s\) de[\s\S]*locale package/,
    );
    expect(() => validateBoot([shop])).not.toThrow();
    expect(() => validateBoot([shop], { requiredLocales: ["en"] })).not.toThrow();
  });
});
