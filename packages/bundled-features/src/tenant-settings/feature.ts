// tenant-settings — per-tenant Currency + Locale defaults.
//
// Any handler that needs a default (money-field currency, a locale-select
// field, ...) reads it via `ctx.config(TenantSettingsConfig.currency)` /
// `ctx.config(TenantSettingsConfig.locale)` — or use
// `defineCreateWithTenantDefaults` (tenant-defaults.ts) to wire it into an
// entity's create-handler without writing that plumbing by hand.
//
// No entities, no hand-written screen — `mask` on both keys makes them
// surface in the self-populating Settings-Hub (Tenant-Audience) instead;
// `buildConfigFeatureSchema` (config feature) derives the configEdit
// screen + nav entry from the key's scope/type/mask, same mechanism as
// samples/recipes/managed-config.

import { defineFeature, type FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { buildTenantSettingsKeys, type TenantSettingsKeyOptions } from "./config";
import { TENANT_SETTINGS_FEATURE_NAME } from "./constants";

export type TenantSettingsFeatureOptions = TenantSettingsKeyOptions;

export function createTenantSettingsFeature(
  opts: TenantSettingsFeatureOptions = {},
): FeatureDefinition {
  return defineFeature(TENANT_SETTINGS_FEATURE_NAME, (r) => {
    r.requires("config");
    r.describe(
      "Per-tenant Currency + Locale defaults, exposed as two config keys (tenant-settings:config:currency, tenant-settings:config:locale) that surface in the self-populating Settings-Hub via `mask`. Pair with defineCreateWithTenantDefaults to auto-fill a money field's currency or a locale field on create instead of hard-coding a literal per entity.",
    );
    r.config({ keys: buildTenantSettingsKeys(opts) });
    r.translations({
      keys: {
        "tenant-settings.currency": { de: "Standard-Währung", en: "Default Currency" },
        "tenant-settings.locale": { de: "Standard-Sprache", en: "Default Locale" },
        // Settings-Hub-derived configEdit screen title (buildConfigFeatureSchema) —
        // required by the i18n boot-validator whenever a feature masks config keys.
        "screen:tenant-settings-system.title": {
          de: "Tenant-Einstellungen",
          en: "Tenant Settings",
        },
        "screen:tenant-settings-tenant.title": {
          de: "Tenant-Einstellungen",
          en: "Tenant Settings",
        },
      },
    });
  });
}

export const tenantSettingsFeature: FeatureDefinition = createTenantSettingsFeature();
