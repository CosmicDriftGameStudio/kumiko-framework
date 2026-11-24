import {
  LETTER_FEATURE,
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
        'Registers a `letterxpress` provider for `letter-foundation` that prints and posts letters within Germany through the LetterXpress API v3. Shipping modes: standard, registered mail with drop-off (`einwurf`) and registered mail (`uebergabe`); no return receipt. The user name (system config key `username`) and the API key (system config key `api-key`, `backing: "secrets"`, envelope-encrypted in the secrets store) are kept by the SystemAdmin in the section "LetterXpress access" of the Platform › Letters settings mask (grouped under `letter-foundation`); a missing value makes the provider refuse with `letter_provider_not_configured`. In production the provider is the one `letter-foundation` uses when its system config key `live` is on, otherwise `letter-foundation` uses the inmemory provider. The provider sends `mode: live` exactly when the live switch is on; its own test mode is therefore not reachable through the resolver.',
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
            group: LETTER_FEATURE,
            mask: {
              title: LETTERXPRESS_I18N.username,
              description: LETTERXPRESS_I18N.usernameHelp,
              icon: "user",
              order: 1,
              section: LETTERXPRESS_I18N.section,
            },
          }),
          [LETTERXPRESS_CONFIG_KEYS.apiKey]: createSystemConfig("text", {
            backing: "secrets",
            write: access.systemAdmin,
            read: access.systemAdmin,
            group: LETTER_FEATURE,
            mask: {
              title: LETTERXPRESS_I18N.apiKey,
              description: LETTERXPRESS_I18N.apiKeyHelp,
              icon: "key",
              order: 2,
              section: LETTERXPRESS_I18N.section,
            },
          }),
        },
      });
      r.translations({
        keys: {
          [LETTERXPRESS_I18N.username]: { en: "LetterXpress user name" },
          [LETTERXPRESS_I18N.apiKey]: { en: "LetterXpress API key" },
          [LETTERXPRESS_I18N.section]: { en: "LetterXpress access" },
          [LETTERXPRESS_I18N.usernameHelp]: {
            en: "User name of the LetterXpress account. Letters are only sent with it while live letter sending is on.",
          },
          [LETTERXPRESS_I18N.apiKeyHelp]: {
            en: "API key of the LetterXpress account. It is stored encrypted and never shown again; enter a new one to replace it.",
          },
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
