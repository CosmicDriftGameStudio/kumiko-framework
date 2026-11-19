import { handlerFieldLabelKey, handlerTitleKey } from "@cosmicdrift/kumiko-framework/engine";
import { SETTINGS_HUB_I18N } from "@cosmicdrift/kumiko-framework/i18n";
import { ConfigHandlers as H } from "./web/constants.ts";

/** Server boot keys for the auto-generated Settings-Hub (mirrors web/i18n.ts) plus handler titles. */
export const CONFIG_FEATURE_I18N = {
  ...SETTINGS_HUB_I18N,
  [handlerTitleKey(H.reset)]: { en: "Reset setting" },
  [handlerFieldLabelKey(H.reset, "key")]: { en: "Setting" },
  [handlerFieldLabelKey(H.reset, "scope")]: { en: "Scope" },
  [handlerTitleKey(H.set)]: { en: "Change setting" },
  [handlerFieldLabelKey(H.set, "key")]: { en: "Setting" },
  [handlerFieldLabelKey(H.set, "value")]: { en: "Value" },
  [handlerFieldLabelKey(H.set, "scope")]: { en: "Scope" },
};
