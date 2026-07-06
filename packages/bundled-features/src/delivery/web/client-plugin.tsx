// @runtime client
import { mergeTranslations, type TranslationsByLocale } from "@cosmicdrift/kumiko-renderer";
import type { ClientFeatureDefinition } from "@cosmicdrift/kumiko-renderer-web";
import { DELIVERY_FEATURE, DELIVERY_LOG_SCREEN_ID } from "../public-names";
import { DeliveryLogScreen } from "./delivery-log-screen";
import { defaultTranslations } from "./i18n";

export type DeliveryClientOptions = {
  readonly translations?: TranslationsByLocale;
};

export function deliveryClient(options?: DeliveryClientOptions): ClientFeatureDefinition {
  return {
    name: DELIVERY_FEATURE,
    translations: mergeTranslations(defaultTranslations, options?.translations ?? {}),
    components: {
      [DELIVERY_LOG_SCREEN_ID]: DeliveryLogScreen,
    },
  };
}
