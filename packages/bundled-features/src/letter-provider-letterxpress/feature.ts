import {
  LETTER_PROVIDER_EXTENSION,
  type LetterProviderPlugin,
} from "@cosmicdrift/kumiko-bundled-features/letter-foundation";
import { access, createSystemConfig, defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import {
  LETTERXPRESS_CONFIG_KEYS,
  LETTERXPRESS_FEATURE,
  LETTERXPRESS_I18N,
  LETTERXPRESS_PROVIDER_NAME,
} from "./constants.ts";
import { letterXpressPlugin } from "./provider.ts";

const plugin: LetterProviderPlugin = letterXpressPlugin;

export function createLetterProviderLetterXpressFeature() {
  return defineFeature(
    LETTERXPRESS_FEATURE,
    (r) => {
      r.describe(
        'Registers a `letterxpress` provider for `letter-foundation` that prints and posts letters within Germany through the LetterXpress API v3. Shipping modes: standard, registered mail with drop-off (`einwurf`) and registered mail (`uebergabe`); no return receipt. The user name (system config key `username`) and the API key (system config key `api-key`, `backing: "secrets"`, envelope-encrypted in the secrets store) are kept by the SystemAdmin in the derived settings mask; a missing value makes the provider refuse with `letter_provider_not_configured`. In production the provider is the one `letter-foundation` uses when its system config key `live` is on, otherwise `letter-foundation` uses the inmemory provider. The provider sends `mode: live` exactly when the live switch is on; its own test mode is therefore not reachable through the resolver.',
      );
      r.uiHints({
        displayLabel: "Letter Provider · LetterXpress",
        category: "notifications",
        recommended: false,
      });
      r.requires({ features: ["letter-foundation", "config", "secrets"] });
      r.config({
        keys: {
          [LETTERXPRESS_CONFIG_KEYS.username]: createSystemConfig("text", {
            write: access.systemAdmin,
            read: access.systemAdmin,
            mask: { title: LETTERXPRESS_I18N.username, icon: "user", order: 1 },
          }),
          [LETTERXPRESS_CONFIG_KEYS.apiKey]: createSystemConfig("text", {
            backing: "secrets",
            write: access.systemAdmin,
            read: access.systemAdmin,
            mask: { title: LETTERXPRESS_I18N.apiKey, icon: "key", order: 2 },
          }),
        },
      });
      r.translations({
        keys: {
          [LETTERXPRESS_I18N.username]: { en: "LetterXpress user name" },
          [LETTERXPRESS_I18N.apiKey]: { en: "LetterXpress API key" },
          "screen:letter-provider-letterxpress-system.title": { en: "LetterXpress" },
          [LETTERXPRESS_I18N.settings]: { en: "LetterXpress" },
        },
      });
      r.applyExtension({
        name: LETTER_PROVIDER_EXTENSION,
        entity: LETTERXPRESS_PROVIDER_NAME,
        ...plugin,
      });
    },
    { dedupeOptions: {} },
  );
}
