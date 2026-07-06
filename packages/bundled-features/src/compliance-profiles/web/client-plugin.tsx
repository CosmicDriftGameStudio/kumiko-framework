// @runtime client
import { mergeTranslations, type TranslationsByLocale } from "@cosmicdrift/kumiko-renderer";
import type { ClientFeatureDefinition } from "@cosmicdrift/kumiko-renderer-web";
import { COMPLIANCE_PROFILE_SCREEN_ID, COMPLIANCE_PROFILES_FEATURE } from "../constants";
import { ComplianceProfileScreen } from "./compliance-profile-screen";
import { defaultTranslations } from "./i18n";

export type ComplianceProfilesClientOptions = {
  readonly translations?: TranslationsByLocale;
};

export function complianceProfilesClient(
  options?: ComplianceProfilesClientOptions,
): ClientFeatureDefinition {
  return {
    name: COMPLIANCE_PROFILES_FEATURE,
    translations: mergeTranslations(defaultTranslations, options?.translations ?? {}),
    components: {
      [COMPLIANCE_PROFILE_SCREEN_ID]: ComplianceProfileScreen,
    },
  };
}
