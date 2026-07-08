// @runtime client
import { mergeTranslations, type TranslationsByLocale } from "@cosmicdrift/kumiko-renderer";
import type { ClientFeatureDefinition } from "@cosmicdrift/kumiko-renderer-web";
import { AUDIT_FEATURE, AUDIT_LOG_DETAIL_SCREEN_ID, AUDIT_LOG_SCREEN_ID } from "../constants";
import { AuditLogDetailScreen } from "./audit-log-detail-screen";
import { AuditLogScreen } from "./audit-log-screen";
import { defaultTranslations } from "./i18n";

export type AuditClientOptions = {
  readonly translations?: TranslationsByLocale;
};

export function auditClient(options?: AuditClientOptions): ClientFeatureDefinition {
  return {
    name: AUDIT_FEATURE,
    translations: mergeTranslations(defaultTranslations, options?.translations ?? {}),
    components: {
      [AUDIT_LOG_SCREEN_ID]: AuditLogScreen,
      [AUDIT_LOG_DETAIL_SCREEN_ID]: AuditLogDetailScreen,
    },
  };
}
