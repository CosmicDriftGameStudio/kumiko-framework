// @runtime client
import { mergeTranslations, type TranslationsByLocale } from "@cosmicdrift/kumiko-renderer";
import type { ClientFeatureDefinition } from "@cosmicdrift/kumiko-renderer-web";
import { MEMBERS_SCREEN_ID, TENANT_FEATURE } from "../constants";
import { defaultTranslations } from "./i18n";
import { MembersScreen } from "./members-screen";

export type TenantClientOptions = {
  readonly translations?: TranslationsByLocale;
};

export function tenantClient(options?: TenantClientOptions): ClientFeatureDefinition {
  return {
    name: TENANT_FEATURE,
    translations: mergeTranslations(defaultTranslations, options?.translations ?? {}),
    components: {
      [MEMBERS_SCREEN_ID]: MembersScreen,
    },
  };
}
