// @runtime client

import type { ClientFeatureDefinition } from "@cosmicdrift/kumiko-renderer-web";
import { FOLDER_SECTION_EXTENSION_NAME, FOLDERS_FEATURE_NAME } from "../constants";
import { FolderSection } from "./folder-section";
import { defaultTranslations } from "./i18n";

export function foldersClient(): ClientFeatureDefinition {
  return {
    name: FOLDERS_FEATURE_NAME,
    extensionSectionComponents: {
      [FOLDER_SECTION_EXTENSION_NAME]: FolderSection,
    },
    translations: defaultTranslations,
  };
}
