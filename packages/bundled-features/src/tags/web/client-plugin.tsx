// @runtime client

import type { ClientFeatureDefinition } from "@cosmicdrift/kumiko-renderer-web";
import {
  TAGS_FEATURE_NAME,
  TAGS_FILTER_EXTENSION_NAME,
  TAGS_SCREEN_ID,
  TAGS_SECTION_EXTENSION_NAME,
} from "../constants";
import { defaultTranslations } from "./i18n";
import { TagFilter } from "./tag-filter";
import { TagManager } from "./tag-manager";
import { TagSection } from "./tag-section";

export function tagsClient(): ClientFeatureDefinition {
  return {
    name: TAGS_FEATURE_NAME,
    extensionSectionComponents: {
      [TAGS_SECTION_EXTENSION_NAME]: TagSection,
      // Header-slot tag filter for any entityList toolbar.
      [TAGS_FILTER_EXTENSION_NAME]: TagFilter,
    },
    // Standalone Tags management screen (custom screen → TagManager).
    components: {
      [TAGS_SCREEN_ID]: TagManager,
    },
    translations: defaultTranslations,
  };
}
