// Demos-Feature — Client-Side. ClientFeatureDefinition mit den
// React-Components für die custom-Screens. createKumikoApp merged
// das in den CustomScreens-Context, KumikoScreen schaut darin nach
// wenn ein Schema-Screen `type: "custom"` hat.

import type { ClientFeatureDefinition } from "@kumiko/renderer-web";
import { demosTranslations } from "./i18n";
import { BannerDemo } from "./pages/banner";
import { ButtonsDemo } from "./pages/buttons";
import { InputsDemo } from "./pages/inputs";
import { LayoutDemo } from "./pages/layout";
import { TextDemo } from "./pages/text";

export const demosClient: ClientFeatureDefinition = {
  name: "showcase-demos",
  translations: demosTranslations,
  components: {
    "demo-layout": LayoutDemo,
    "demo-buttons": ButtonsDemo,
    "demo-inputs": InputsDemo,
    "demo-banner": BannerDemo,
    "demo-text": TextDemo,
  },
};
