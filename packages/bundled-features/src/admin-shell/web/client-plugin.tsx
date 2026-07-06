// @runtime client
import { mergeTranslations, type TranslationsByLocale } from "@cosmicdrift/kumiko-renderer";
import type { ClientFeatureDefinition } from "@cosmicdrift/kumiko-renderer-web";
import { ADMIN_SHELL_FEATURE } from "../constants";
import { defaultTranslations } from "./i18n";

export type AdminShellClientOptions = {
  readonly translations?: TranslationsByLocale;
};

export function adminShellClient(options?: AdminShellClientOptions): ClientFeatureDefinition {
  return {
    name: ADMIN_SHELL_FEATURE,
    translations: mergeTranslations(defaultTranslations, options?.translations ?? {}),
    components: {},
  };
}
