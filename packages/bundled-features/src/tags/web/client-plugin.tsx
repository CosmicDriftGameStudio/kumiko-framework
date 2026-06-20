// @runtime client
// Client-feature factory for tags. Mounted via
// createKumikoApp({ clientFeatures: [tagsClient()] }) — registers TagSection
// under TAGS_SECTION_EXTENSION_NAME and contributes the default translations.
// Required even for standalone <TagSection> use, otherwise its i18n keys render
// raw.

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
