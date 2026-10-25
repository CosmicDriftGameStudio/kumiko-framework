// Items feature — web platform plugin. ClientFeatureDefinition with
// translations. Items currently has no custom-screen components
// (renders via the standard RenderEdit/RenderList), accordingly no
// `components` map.
//
// A native platform would live alongside it in features/items/native/
// — translations are shared, components/UI are not.

import type { ClientFeatureDefinition } from "@cosmicdrift/kumiko-renderer/web";
import { itemsTranslations } from "../i18n";

export const itemsClient: ClientFeatureDefinition = {
  name: "showcase",
  translations: itemsTranslations,
};
