import {
  LETTER_PROVIDER_EXTENSION,
  type LetterProviderPlugin,
} from "@cosmicdrift/kumiko-bundled-features/letter-foundation";
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { featureWithEnvSchema } from "@cosmicdrift/kumiko-framework/env";
import { LETTERXPRESS_FEATURE, LETTERXPRESS_PROVIDER_NAME } from "./constants.ts";
import { letterXpressEnvSchema } from "./env-schema.ts";
import { letterXpressPlugin } from "./provider.ts";

const plugin: LetterProviderPlugin = letterXpressPlugin;

export function createLetterProviderLetterXpressFeature() {
  const feature = defineFeature(
    LETTERXPRESS_FEATURE,
    (r) => {
      r.describe(
        "Registers a `letterxpress` provider for `letter-foundation` that prints and posts letters within Germany through the LetterXpress API v3. Shipping modes: standard, registered mail with drop-off (`einwurf`) and registered mail (`uebergabe`); no return receipt. Needs `LETTERXPRESS_USERNAME` and `LETTERXPRESS_API_KEY`. The provider is picked by `LETTER_PROVIDER=letterxpress` and only runs when `LETTER_LIVE=true` is set, otherwise `letter-foundation` uses the inmemory provider. The provider sends `mode: live` exactly when the live switch is on; its own test mode is therefore not reachable through the resolver.",
      );
      r.uiHints({
        displayLabel: "Letter Provider · LetterXpress",
        category: "notifications",
        recommended: false,
      });
      r.requires({ features: ["letter-foundation"] });
      r.envSchema(letterXpressEnvSchema);
      r.applyExtension({
        name: LETTER_PROVIDER_EXTENSION,
        entity: LETTERXPRESS_PROVIDER_NAME,
        ...plugin,
      });
    },
    { dedupeOptions: {} },
  );
  return featureWithEnvSchema(feature, letterXpressEnvSchema);
}
