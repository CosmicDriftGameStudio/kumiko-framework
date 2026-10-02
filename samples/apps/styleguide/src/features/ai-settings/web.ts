import type {
  ClientFeatureDefinition,
  TranslationsByLocale,
} from "@cosmicdrift/kumiko-renderer-web";

import { toClientTranslations } from "../shared-i18n";
import { AI_SETTINGS_I18N } from "./i18n";

const translations: TranslationsByLocale = toClientTranslations(AI_SETTINGS_I18N);

export const aiSettingsClient: ClientFeatureDefinition = {
  name: "ai-settings",
  translations,
};
