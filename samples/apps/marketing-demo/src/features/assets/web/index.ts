// Assets — ClientFeatureDefinition. Pure Schema-driven, keine Custom-
// Components. Render läuft über Standard-RenderList + RenderEdit.

import type { ClientFeatureDefinition } from "@cosmicdrift/kumiko-renderer-web";
import { assetsTranslations } from "../i18n";

export const assetsClient: ClientFeatureDefinition = {
  name: "assets",
  translations: assetsTranslations,
};
