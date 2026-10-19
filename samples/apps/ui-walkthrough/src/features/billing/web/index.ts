import type { ClientFeatureDefinition } from "@cosmicdrift/kumiko-renderer/web";
import { billingTranslations } from "../i18n";

export const billingClient: ClientFeatureDefinition = {
  name: "billing",
  translations: billingTranslations,
};
