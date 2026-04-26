// Items-Feature — Web-Plattform-Plugin. ClientFeatureDefinition mit
// Translations. Items hat heute keine Custom-Screen-Components
// (rendert über Standard-RenderEdit/RenderList), entsprechend keine
// `components`-Map.
//
// Native-Plattform würde parallel dazu in features/items/native/
// liegen — translations werden geteilt, components/UI nicht.

import type { ClientFeatureDefinition } from "@kumiko/renderer-web";
import { itemsTranslations } from "../i18n";

export const itemsClient: ClientFeatureDefinition = {
  name: "showcase",
  translations: itemsTranslations,
};
