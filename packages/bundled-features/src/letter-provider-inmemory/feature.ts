import {
  LETTER_PROVIDER_EXTENSION,
  type LetterProviderPlugin,
} from "@cosmicdrift/kumiko-bundled-features/letter-foundation";
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { LETTER_PROVIDER_INMEMORY_FEATURE, LETTER_PROVIDER_INMEMORY_NAME } from "./constants.ts";
import { INMEMORY_CAPABILITIES, letterSimulator } from "./simulator.ts";

const plugin: LetterProviderPlugin = {
  capabilities: INMEMORY_CAPABILITIES,
  build: async () => letterSimulator.provider,
};

export function createLetterProviderInMemoryFeature() {
  return defineFeature(
    LETTER_PROVIDER_INMEMORY_FEATURE,
    (r) => {
      r.describe(
        "Registers an `inmemory` provider for `letter-foundation` that accepts letters in process memory instead of printing them. Tests steer it with `letterSimulator.setScenario` (accept, reject, timeout, on hold, other price or recognized address) and `setClock`; it is the provider that runs outside production, whatever the live switch says. Not for production: nothing is sent.",
      );
      r.uiHints({
        displayLabel: "Letter Provider · In-memory",
        category: "notifications",
        recommended: false,
      });
      r.requires({ features: ["letter-foundation"] });
      r.applyExtension({
        name: LETTER_PROVIDER_EXTENSION,
        entity: LETTER_PROVIDER_INMEMORY_NAME,
        ...plugin,
      });
    },
    { dedupeOptions: {} },
  );
}
