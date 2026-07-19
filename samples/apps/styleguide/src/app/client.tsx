import { createKumikoApp } from "@cosmicdrift/kumiko-renderer-web";
import { contentClient } from "../features/content/web";
import { styleguideClient } from "../features/demo/web";
import { examplesClient } from "../features/examples/web";
import { galleryClient } from "../features/gallery/web";
import { widgetsClient } from "../features/widgets/web";
import { AppShell } from "./shell";

// Schema kommt vom dev-server via window.__KUMIKO_SCHEMA__. styleguideClient
// liefert die Feld-Label-Übersetzungen, galleryClient die custom Gallery-Screen,
// widgetsClient den Widget-Kit-Katalog, examplesClient die Config-Stresstest-
// Screens (Shipping etc.).
createKumikoApp({
  shell: AppShell,
  clientFeatures: [styleguideClient, galleryClient, widgetsClient, examplesClient, contentClient()],
});
