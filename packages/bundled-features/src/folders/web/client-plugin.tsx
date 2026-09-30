// @runtime client

import type { ClientFeatureDefinition } from "@cosmicdrift/kumiko-renderer-web";
import { FOLDER_SECTION_EXTENSION_NAME, FOLDERS_FEATURE_NAME } from "../constants.js";
import { FolderSection } from "./folder-section.js";
import { defaultTranslations } from "./i18n.js";

export function foldersClient(): ClientFeatureDefinition {
  return {
    name: FOLDERS_FEATURE_NAME,
    extensionSectionComponents: {
      [FOLDER_SECTION_EXTENSION_NAME]: FolderSection,
    },
    translations: defaultTranslations,
  };
}
