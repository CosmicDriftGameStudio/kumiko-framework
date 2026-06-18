// @runtime client
// Client-Feature-Factory für tier-engine. Liefert den TierAdminScreen
// (gemappt auf die Screen-id "tier-admin") + Default-Translations. Apps
// hängen es in createKumikoApp({ clientFeatures: [tierEngineClient()] }) ein;
// der Screen selbst wird server-seitig vom Feature als custom-Screen
// registriert (r.screen), die App platziert ihn nur via r.nav.

import { mergeTranslations, type TranslationsByLocale } from "@cosmicdrift/kumiko-renderer";
import type { ClientFeatureDefinition } from "@cosmicdrift/kumiko-renderer-web";
import { TIER_ADMIN_SCREEN_ID, TIER_ENGINE_FEATURE } from "../constants";
import { defaultTranslations } from "../i18n";
import { TierAdminScreen } from "./tier-admin-screen";

export type TierEngineClientOptions = {
  /** Key-weise Overrides über die Default-Bundles (de/en). */
  readonly translations?: TranslationsByLocale;
};

export function tierEngineClient(options?: TierEngineClientOptions): ClientFeatureDefinition {
  return {
    name: TIER_ENGINE_FEATURE,
    translations: mergeTranslations(defaultTranslations, options?.translations ?? {}),
    components: {
      [TIER_ADMIN_SCREEN_ID]: TierAdminScreen,
    },
  };
}
