import type { ClientFeatureDefinition } from "@cosmicdrift/kumiko-renderer/web";
import {
  TAGS_COLUMN_RENDERER_NAME,
  TAGS_FEATURE_NAME,
  TAGS_FILTER_EXTENSION_NAME,
  TAGS_SECTION_EXTENSION_NAME,
} from "./constants.ts";
import { defaultTranslations } from "./i18n.ts";
import { TagFilter } from "./tag-filter.tsx";
import { TagSection } from "./tag-section.tsx";
import { TagsCell } from "./tags-cell.tsx";

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
    // Catalog screen is declarative entityList — no custom TagsScreen mount.
    translations: defaultTranslations,
  };
}
