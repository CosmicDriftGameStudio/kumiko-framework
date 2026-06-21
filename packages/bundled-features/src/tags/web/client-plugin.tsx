// @runtime client

import type { ClientFeatureDefinition } from "@cosmicdrift/kumiko-renderer-web";
import { TAGS_FEATURE_NAME, TAGS_SECTION_EXTENSION_NAME } from "../constants";
import { defaultTranslations } from "./i18n";
import { TagSection } from "./tag-section";

export function tagsClient(): ClientFeatureDefinition {
  return {
    name: TAGS_FEATURE_NAME,
    extensionSectionComponents: {
      [TAGS_SECTION_EXTENSION_NAME]: TagSection,
    },
    translations: defaultTranslations,
  };
}
