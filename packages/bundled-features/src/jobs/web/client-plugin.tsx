// @runtime client
import { mergeTranslations, type TranslationsByLocale } from "@cosmicdrift/kumiko-renderer";
import type { ClientFeatureDefinition } from "@cosmicdrift/kumiko-renderer-web";
import { JOBS_FEATURE } from "../constants";
import { defaultTranslations } from "./i18n";

export type JobsClientOptions = {
  readonly translations?: TranslationsByLocale;
};

export function jobsClient(options?: JobsClientOptions): ClientFeatureDefinition {
  return {
    name: JOBS_FEATURE,
    translations: mergeTranslations(defaultTranslations, options?.translations ?? {}),
  };
}
