// Items-Feature — Client-Side. ClientFeatureDefinition mit
// Translations. Items hat heute keine Custom-Components (rendert über
// die Standard-RenderEdit/RenderList-Pipeline), entsprechend keine
// `components`-Map.

import type { ClientFeatureDefinition } from "@kumiko/renderer-web";
import { itemsTranslations } from "./i18n";

export const itemsClient: ClientFeatureDefinition = {
  name: "showcase",
  translations: itemsTranslations,
};
