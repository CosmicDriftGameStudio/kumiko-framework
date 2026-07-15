import type {
  ClientFeatureDefinition,
  TranslationsByLocale,
} from "@cosmicdrift/kumiko-renderer-web";
import { toClientTranslations } from "../shared-i18n";
import { DEMO_I18N } from "./i18n";

const translations: TranslationsByLocale = toClientTranslations(DEMO_I18N);

export const styleguideClient: ClientFeatureDefinition = {
  name: "styleguide",
  translations,
};
