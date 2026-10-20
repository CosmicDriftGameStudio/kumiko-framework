import { mergeTranslations, type TranslationsByLocale } from "@cosmicdrift/kumiko-renderer";
import type { ClientFeatureDefinition } from "@cosmicdrift/kumiko-renderer/web";
import { ComplianceProfileCatalog } from "./compliance-profile-catalog.tsx";
import {
  COMPLIANCE_PROFILE_CATALOG_EXTENSION_NAME,
  COMPLIANCE_PROFILES_FEATURE,
} from "./constants.ts";
import { defaultTranslations } from "./i18n.ts";

export type ComplianceProfilesClientOptions = {
  readonly translations?: TranslationsByLocale;
};

export function complianceProfilesClient(
  options?: ComplianceProfilesClientOptions,
): ClientFeatureDefinition {
  return {
    name: COMPLIANCE_PROFILES_FEATURE,
    translations: mergeTranslations(defaultTranslations, options?.translations ?? {}),
    extensionSectionComponents: {
      [COMPLIANCE_PROFILE_CATALOG_EXTENSION_NAME]: ComplianceProfileCatalog,
    },
  };
}
