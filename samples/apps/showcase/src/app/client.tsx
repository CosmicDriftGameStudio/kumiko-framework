// Browser entry. Thin — only collects the ClientFeatureDefinitions from
// the app features and hands shell + clientFeatures to
// createKumikoApp. The framework does custom-screen routing itself
// via clientFeatures.components.

import { localeDeClient } from "@cosmicdrift/kumiko-locale-de/web";
import { createKumikoApp } from "@cosmicdrift/kumiko-renderer/web";
import { demosClient } from "../features/demos/web";
import { itemsClient } from "../features/items/web";
import { AppShell } from "./shell";

createKumikoApp({
  shell: AppShell,
  clientFeatures: [localeDeClient(), itemsClient, demosClient],
});
