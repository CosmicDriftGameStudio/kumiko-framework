// @runtime client
import { mergeTranslations, type TranslationsByLocale } from "@cosmicdrift/kumiko-renderer";
import type { ClientFeatureDefinition } from "@cosmicdrift/kumiko-renderer-web";
import { AUDIT_FEATURE } from "../constants";
import { defaultTranslations } from "./i18n";

export type AuditClientOptions = {
  readonly translations?: TranslationsByLocale;
};

export function auditClient(options?: AuditClientOptions): ClientFeatureDefinition {
  return {
    name: AUDIT_FEATURE,
    translations: mergeTranslations(defaultTranslations, options?.translations ?? {}),
  };
}
