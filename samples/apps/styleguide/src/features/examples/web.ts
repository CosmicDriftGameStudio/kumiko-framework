import type {
  ClientFeatureDefinition,
  TranslationsByLocale,
} from "@cosmicdrift/kumiko-renderer-web";

import { toClientTranslations } from "../shared-i18n";
import { EXAMPLES_I18N } from "./i18n";

const translations: TranslationsByLocale = toClientTranslations(EXAMPLES_I18N);

export const examplesClient: ClientFeatureDefinition = {
  name: "examples",
  translations,
};
