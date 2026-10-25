// Demos feature — web platform plugin. ClientFeatureDefinition with
// the React DOM components for the custom screens. createKumikoApp
// merges that into the CustomScreens context, KumikoScreen looks there
// when a schema screen has `type: "custom"`.

import type { ClientFeatureDefinition } from "@cosmicdrift/kumiko-renderer/web";
import { demosTranslations } from "../i18n";
import { BannerDemo } from "./pages/banner";
import { ButtonsDemo } from "./pages/buttons";
import { DialogDemo } from "./pages/dialog";
import { InputsDemo } from "./pages/inputs";
import { LayoutDemo } from "./pages/layout";
import { SidebarPanelDemo } from "./pages/sidebar-panel";
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
    "demo-sidebar-panel": SidebarPanelDemo,
    "demo-text": TextDemo,
  },
};
