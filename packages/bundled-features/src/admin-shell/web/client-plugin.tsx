// @runtime client
import { mergeTranslations, type TranslationsByLocale } from "@cosmicdrift/kumiko-renderer";
import type { ClientFeatureDefinition } from "@cosmicdrift/kumiko-renderer-web";
import {
  ADMIN_SHELL_FEATURE,
  PLATFORM_OVERVIEW_SCREEN_ID,
  TENANT_OVERVIEW_SCREEN_ID,
} from "../constants";
import { defaultTranslations } from "./i18n";
import { PlatformOverviewScreen } from "./platform-overview-screen";
import { TenantOverviewScreen } from "./tenant-overview-screen";

export type AdminShellClientOptions = {
  readonly translations?: TranslationsByLocale;
};

export function adminShellClient(options?: AdminShellClientOptions): ClientFeatureDefinition {
  return {
    name: ADMIN_SHELL_FEATURE,
    translations: mergeTranslations(defaultTranslations, options?.translations ?? {}),
    components: {
      [TENANT_OVERVIEW_SCREEN_ID]: TenantOverviewScreen,
      [PLATFORM_OVERVIEW_SCREEN_ID]: PlatformOverviewScreen,
    },
  };
}
