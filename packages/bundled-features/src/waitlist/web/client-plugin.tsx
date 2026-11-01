import { mergeTranslations, type TranslationsByLocale } from "@cosmicdrift/kumiko-renderer";
import type { ClientFeatureDefinition } from "@cosmicdrift/kumiko-renderer/web";
import { defaultTranslations } from "./i18n.ts";

export type WaitlistClientOptions = {
  readonly translations?: TranslationsByLocale;
};

export function waitlistClient(options?: WaitlistClientOptions): ClientFeatureDefinition {
  return {
    name: "waitlist",
    translations: mergeTranslations(defaultTranslations, options?.translations ?? {}),
  };
}
