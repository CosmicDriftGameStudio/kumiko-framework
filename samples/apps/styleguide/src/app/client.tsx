import { localeDeClient } from "@cosmicdrift/kumiko-locale-de/web";
import { createKumikoApp } from "@cosmicdrift/kumiko-renderer-web";
import { contentClient } from "../features/content/web";
import { styleguideClient } from "../features/demo/web";
import { examplesClient } from "../features/examples/web";
import { galleryClient } from "../features/gallery/web";
import { widgetsClient } from "../features/widgets/web";
import { AppShell } from "./shell";

// createKumikoApp fetches the schema itself from the authenticated
// GET /api/schema. styleguideClient supplies the field-label translations,
// galleryClient the custom gallery screen, widgetsClient the widget-kit
// catalog, examplesClient the config-stresstest screens (shipping etc.).
createKumikoApp({
  shell: AppShell,
  clientFeatures: [
    localeDeClient(),
    styleguideClient,
    galleryClient,
    widgetsClient,
    examplesClient,
    contentClient(),
  ],
});
