// Assets — ClientFeatureDefinition. Purely schema-driven, no custom
// components. Rendering goes through the standard RenderList + RenderEdit.

import type { ClientFeatureDefinition } from "@cosmicdrift/kumiko-renderer/web";
import { assetsTranslations } from "../i18n";

export const assetsClient: ClientFeatureDefinition = {
  name: "assets",
  translations: assetsTranslations,
};
