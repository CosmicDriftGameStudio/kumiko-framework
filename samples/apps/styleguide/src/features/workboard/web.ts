import type {
  ClientFeatureDefinition,
  TranslationsByLocale,
} from "@cosmicdrift/kumiko-renderer/web";
import { toClientTranslations } from "../shared-i18n";
import { WORKBOARD_I18N } from "./i18n";

const translations: TranslationsByLocale = toClientTranslations(WORKBOARD_I18N);

export const workboardClient: ClientFeatureDefinition = {
  name: "workboard",
  translations,
};
