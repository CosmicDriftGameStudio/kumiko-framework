// @runtime client

import type { ClientFeatureDefinition } from "@cosmicdrift/kumiko-renderer-web";
import { NOTES_HISTORY_FEATURE_NAME, NOTES_SECTION_EXTENSION_NAME } from "../constants.ts";
import { defaultTranslations } from "./i18n.ts";
import { NotesSection } from "./notes-section.tsx";

export function notesHistoryClient(): ClientFeatureDefinition {
  return {
    name: NOTES_HISTORY_FEATURE_NAME,
    extensionSectionComponents: {
      [NOTES_SECTION_EXTENSION_NAME]: NotesSection,
    },
    translations: defaultTranslations,
  };
}
