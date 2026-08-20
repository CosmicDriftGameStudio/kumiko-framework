import { describe, expect, test } from "bun:test";
import { access, createTenantConfig } from "../../config-helpers";
import { defineFeature } from "../../define-feature";
import { validateBoot } from "../index";

// fw#2260: the Settings-Hub generator (buildConfigFeatureSchema) labels a
// masked config key's generated nav entry / configEdit section with the
// dot-form key `${feature}.settings` — never colon-form. isI18nKey's
// colon-only check dropped that label from the required-keys set, so a
// feature could ship a generated Settings screen whose label was never
// translated and boot validation stayed silent.
describe("validateI18nSurfaceKeys — Settings-Hub generated dot-form label (fw#2260)", () => {
  // Mirrors packages/bundled-features/src/config/i18n.ts — the audience-parent
  // labels every masked config key's generated hub requires regardless of
  // which feature owns the key.
  const configHub = defineFeature("config", (r) => {
    r.translations({
      keys: {
        "config.settings.title": { en: "Settings" },
        "config.settings.system": { en: "Platform" },
        "config.settings.tenant": { en: "Organization" },
        "config.settings.user": { en: "Personal" },
      },
    });
  });

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
});
