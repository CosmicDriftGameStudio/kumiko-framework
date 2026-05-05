// Demos-Feature — Web-Plattform-Plugin. ClientFeatureDefinition mit
// den React-DOM-Components für die custom-Screens. createKumikoApp
// merged das in den CustomScreens-Context, KumikoScreen schaut darin
// nach wenn ein Schema-Screen `type: "custom"` hat.

import type { ClientFeatureDefinition } from "@cosmicdrift/kumiko-renderer-web";
import { demosTranslations } from "../i18n";
import { BannerDemo } from "./pages/banner";
import { ButtonsDemo } from "./pages/buttons";
import { DialogDemo } from "./pages/dialog";
import { InputsDemo } from "./pages/inputs";
import { LayoutDemo } from "./pages/layout";
import { TextDemo } from "./pages/text";
import { ToastDemo } from "./pages/toast";

export const demosClient: ClientFeatureDefinition = {
  name: "showcase-demos",
  translations: demosTranslations,
  components: {
    "demo-layout": LayoutDemo,
    "demo-buttons": ButtonsDemo,
    "demo-inputs": InputsDemo,
    "demo-banner": BannerDemo,
    "demo-dialog": DialogDemo,
    "demo-toast": ToastDemo,
    "demo-text": TextDemo,
  },
};
