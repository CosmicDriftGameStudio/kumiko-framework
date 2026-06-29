// @runtime client

import type { ClientFeatureDefinition } from "@cosmicdrift/kumiko-renderer-web";
import {
  TAGS_COLUMN_RENDERER_NAME,
  TAGS_FEATURE_NAME,
  TAGS_FILTER_EXTENSION_NAME,
  TAGS_SCREEN_ID,
  TAGS_SECTION_EXTENSION_NAME,
} from "../constants";
import { defaultTranslations } from "./i18n";
import { TagFilter } from "./tag-filter";
import { TagManager } from "./tag-manager";
import { TagSection } from "./tag-section";
import { TagsCell } from "./tags-cell";

export function tagsClient(): ClientFeatureDefinition {
  return {
    name: TAGS_FEATURE_NAME,
    extensionSectionComponents: {
      [TAGS_SECTION_EXTENSION_NAME]: TagSection,
      // Header-slot tag filter for any entityList toolbar.
      [TAGS_FILTER_EXTENSION_NAME]: TagFilter,
    },
    // Inline tag chips on any entityList row, via a labeled virtual column.
    columnRenderers: {
      [TAGS_COLUMN_RENDERER_NAME]: TagsCell,
    },
    // Standalone Tags management screen (custom screen → TagManager).
    components: {
      [TAGS_SCREEN_ID]: TagManager,
    },
    translations: defaultTranslations,
  };
}
